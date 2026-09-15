// ─────────────────────────────────────────────────────────────────────────────
// customParsers.ts
//
// Parsers de formato fixo que não passam pelo motor genérico de mapeamento
// de colunas (importConfigs.ts + parseUtils.ts) porque a "planilha" de
// origem não é uma tabela retangular comum.
//
//  - parsePontoMatrix        -> pontos ADM/FTX (PIS/COFINS), matriz com
//                                marcadores ID_PONTO/ID_TRIBUTO.
//  - parseJobIdentification  -> identificação do job (Relatório 1).
//  - parseIpiComparativo     -> pontos ADM IPI. Sem ID_PONTO — o nome do
//                                ponto vem do título da aba "Comparativo"
//                                (ex.: "Desembaraço Aduaneiro - IPI") e os
//                                valores vêm da linha "Créditos de IPI" de
//                                cada bloco de ano.
//  - parseIrCsllTotais       -> pontos ADM IR/CSLL. Um único arquivo cobre
//                                vários pontos de uma vez, lidos da aba
//                                "Totais": cada ponto ocupa duas linhas
//                                consecutivas (IRPJ, depois CSLL) com um
//                                valor por ano (2021..2026).
// ─────────────────────────────────────────────────────────────────────────────

import { parseNumber } from "./parseUtils";

// ─── Normalização compartilhada ──────────────────────────────────────────────

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function normalizeKey(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}

// ═════════════════════════════════════════════════════════════════════════
// Matriz de pontos (ADM/FTX, PIS/COFINS) — "Importar ponto" / "Importar vários pontos"
// ═════════════════════════════════════════════════════════════════════════

export interface ParsedPontoMonthlyRow {
  external_point_id: number;
  point_name: string | null;
  external_tax_id: number | null;
  reference_month: string;
  contribution: "PIS" | "COFINS";
  value: number;
}

export interface ParsePontoMatrixResult {
  rows: ParsedPontoMonthlyRow[];
  externalPointId: number | null;
  externalTaxId: number | null;
  warnings: string[];
}

const MONTH_COUNT = 12;

function extractId(cell: string | undefined): number | null {
  if (!cell) return null;
  const digitsOnly = cell.replace(/\D/g, "");
  if (digitsOnly === "") return null;
  const n = Number(digitsOnly);
  return Number.isNaN(n) ? null : n;
}

export function parsePontoMatrix(grid: string[][], pointNameHint?: string): ParsePontoMatrixResult {
  const warnings: string[] = [];
  let externalPointId: number | null = null;
  let externalTaxId: number | null = null;
  const rawRows: Omit<ParsedPontoMonthlyRow, "external_point_id">[] = [];

  for (const row of grid) {
    const cells = row.map((c) => (c ?? "").trim());
    const firstNonEmptyIdx = cells.findIndex((c) => c !== "");
    if (firstNonEmptyIdx === -1) continue;

    const label = normalize(cells[firstNonEmptyIdx]);

    if (label === "id_tributo" || label === "id_ponto") {
      const valueCell = cells.slice(firstNonEmptyIdx + 1).find((c) => c !== "");
      const value = extractId(valueCell);
      if (value !== null) {
        if (label === "id_tributo") externalTaxId = value;
        else externalPointId = value;
      }
      continue;
    }

    const yearMatch = cells[firstNonEmptyIdx].match(/^(20\d{2})$/);
    if (!yearMatch) continue;

    const year = Number(yearMatch[1]);
    const monthCells = cells.slice(firstNonEmptyIdx + 1, firstNonEmptyIdx + 1 + MONTH_COUNT);
    const rest = cells.slice(firstNonEmptyIdx + 1 + MONTH_COUNT);
    const flagCell = rest.find((c) => /^[pc]$/i.test(c));
    const contribution = flagCell?.toUpperCase() === "P" ? "PIS" : flagCell?.toUpperCase() === "C" ? "COFINS" : null;

    if (!contribution) {
      warnings.push(`Linha do ano ${year} sem marcador P/C identificável — ignorada.`);
      continue;
    }
    if (monthCells.length < MONTH_COUNT) {
      warnings.push(`Linha do ano ${year} (${contribution}) com menos de 12 colunas de mês — faltantes tratados como vazio.`);
    }

    for (let m = 0; m < MONTH_COUNT; m++) {
      const raw = monthCells[m] ?? "";
      if (raw.trim() === "") continue;

      const value = parseNumber(raw);
      if (value === null) {
        warnings.push(`Valor inválido em ${contribution} ${year}-${String(m + 1).padStart(2, "0")}: "${raw}" — tratado como 0.`);
      }

      rawRows.push({
        point_name: pointNameHint ?? null,
        external_tax_id: externalTaxId,
        reference_month: `${year}-${String(m + 1).padStart(2, "0")}-01`,
        contribution,
        value: value ?? 0,
      });
    }
  }

  if (externalPointId === null) {
    warnings.push("ID_PONTO não encontrado nos dados colados/enviados.");
  }

  const finalPointId = externalPointId ?? 0;
  const rows: ParsedPontoMonthlyRow[] = rawRows.map((r) => ({ ...r, external_point_id: finalPointId }));

  return { rows, externalPointId, externalTaxId, warnings };
}

// ═════════════════════════════════════════════════════════════════════════
// Identificação do job (Relatório 1) — "Importar identificação"
// ═════════════════════════════════════════════════════════════════════════

export interface ParsedJobIdentification {
  job_number: string | null;
  company_name: string | null;
  segment: string | null;
  tax_regime: "Lucro Real" | "Lucro Presumido" | "Simples Nacional" | "Lucro Arbitrado" | null;
}

const REGIME_MAP: Record<string, ParsedJobIdentification["tax_regime"]> = {
  lucroreal: "Lucro Real",
  lucropresumido: "Lucro Presumido",
  simplesnacional: "Simples Nacional",
  lucroarbitrado: "Lucro Arbitrado",
};

export function parseJobIdentification(headers: string[], rows: string[][]): ParsedJobIdentification | null {
  if (rows.length === 0) return null;
  const normalizedHeaders = headers.map(normalizeKey);

  const jobIdx = normalizedHeaders.findIndex((h) => h === "job");
  const nameIdx = normalizedHeaders.findIndex((h) => h === "nome");
  const productIdx = normalizedHeaders.findIndex((h) => h === "nomeproduto");
  const subproductIdx = normalizedHeaders.findIndex((h) => h === "nomesubproduto");
  const regimeIdx = normalizedHeaders.findIndex((h) => h === "regimedetributacao" || h === "regimetributario");

  const row = rows[0];

  const product = productIdx >= 0 ? (row[productIdx] ?? "").trim() : "";
  const subproduct = subproductIdx >= 0 ? (row[subproductIdx] ?? "").trim() : "";
  const segment = [product, subproduct].filter(Boolean).join(" — ") || null;

  const regimeRaw = regimeIdx >= 0 ? normalizeKey(row[regimeIdx] ?? "") : "";

  return {
    job_number: jobIdx >= 0 ? (row[jobIdx] ?? "").trim() || null : null,
    company_name: nameIdx >= 0 ? (row[nameIdx] ?? "").trim() || null : null,
    segment,
    tax_regime: REGIME_MAP[regimeRaw] ?? null,
  };
}

// ═════════════════════════════════════════════════════════════════════════
// IPI — "Importar pontos ADM IPI". 1 arquivo = 1 ponto, sem ID_PONTO: o
// nome do ponto vem do título ("<Nome> - IPI") e os valores vêm da linha
// "Créditos de IPI" de cada bloco de ano na aba "Comparativo".
// ═════════════════════════════════════════════════════════════════════════

export interface ParsedIpiMonthlyRow {
  reference_month: string; // YYYY-MM-01
  value: number;
}

export interface ParseIpiComparativoResult {
  pointName: string | null;
  rows: ParsedIpiMonthlyRow[];
  warnings: string[];
}

const CREDITOS_IPI_LABEL = normalize("Créditos de IPI");

export function parseIpiComparativo(grid: string[][], pointNameOverride?: string): ParseIpiComparativoResult {
  const warnings: string[] = [];

  let pointName = pointNameOverride?.trim() || null;
  if (!pointName) {
    const title = (grid[0]?.[0] ?? "").trim();
    pointName = title.replace(/\s*-\s*IPI\s*$/i, "").trim() || null;
    if (!pointName) warnings.push('Não foi possível identificar o nome do ponto no título da aba "Comparativo". Informe manualmente.');
  }

  const rows: ParsedIpiMonthlyRow[] = [];
  let currentYear: number | null = null;

  for (const row of grid) {
    const cells = row.map((c) => (c ?? "").trim());
    const firstNonEmptyIdx = cells.findIndex((c) => c !== "");
    if (firstNonEmptyIdx === -1) continue;

    const yearMatch = cells[firstNonEmptyIdx].match(/^(20\d{2})$/);
    if (yearMatch && cells.slice(firstNonEmptyIdx + 1, firstNonEmptyIdx + 4).some((c) => /jan|fev|mar/i.test(c))) {
      currentYear = Number(yearMatch[1]);
      continue;
    }

    if (normalize(cells[firstNonEmptyIdx]) === CREDITOS_IPI_LABEL) {
      if (!currentYear) {
        warnings.push('Linha "Créditos de IPI" encontrada antes de qualquer cabeçalho de ano — ignorada.');
        continue;
      }
      const monthCells = cells.slice(firstNonEmptyIdx + 1, firstNonEmptyIdx + 1 + MONTH_COUNT);
      for (let m = 0; m < MONTH_COUNT; m++) {
        const raw = monthCells[m] ?? "";
        if (raw === "") continue; // célula genuinamente ausente — "-" já é tratado como 0 por parseNumber
        const value = parseNumber(raw);
        if (value === null) {
          warnings.push(`Valor inválido em ${currentYear}-${String(m + 1).padStart(2, "0")}: "${raw}" — tratado como 0.`);
        }
        rows.push({
          reference_month: `${currentYear}-${String(m + 1).padStart(2, "0")}-01`,
          value: value ?? 0,
        });
      }
    }
  }

  if (rows.length === 0) warnings.push('Nenhum valor de "Créditos de IPI" encontrado nos dados enviados.');

  return { pointName, rows, warnings };
}

// ═════════════════════════════════════════════════════════════════════════
// IR/CSLL — "Importar Pontos IR/CSLL". 1 arquivo = N pontos, lidos da aba
// "Totais": cabeçalho "Pontos | 2021 | 2022 | ... | Total", e cada ponto
// ocupa duas linhas consecutivas (1ª = IRPJ com o nome, 2ª = CSLL sem nome).
// O bloco termina quando aparece uma linha cujo nome é "IRPJ" ou "CSLL"
// (início do resumo por tributo, que não nos interessa aqui).
// ═════════════════════════════════════════════════════════════════════════

export interface ParsedIrCsllRow {
  point_name: string;
  reference_year: number;
  tax_sub_type: "IRPJ" | "CSLL";
  value: number;
}

export interface ParseIrCsllTotaisResult {
  rows: ParsedIrCsllRow[];
  pointNames: string[];
  warnings: string[];
}

// IMPORTANTE: este parser espera um grid que preserve linhas EM BRANCO
// (leia o arquivo com parseXlsxNamedSheetMatrixKeepBlanks, não com
// parseXlsxRawMatrix). O motivo: cada ponto ocupa exatamente 2 linhas
// consecutivas (1ª = IRPJ com o nome, 2ª = CSLL sem nome), e quando o
// valor de CSLL de um ponto está vazio (não "0"), a 2ª linha fica
// totalmente em branco — se o leitor descartar linhas em branco (como
// parseXlsxRawMatrix faz), o pareamento de TODOS os pontos seguintes
// desalinha. O pareamento aqui é posicional (i, i+1), não por conteúdo.
export function parseIrCsllTotais(grid: string[][]): ParseIrCsllTotaisResult {
  const warnings: string[] = [];
  const rows: ParsedIrCsllRow[] = [];
  const pointNames: string[] = [];

  // Acha a linha de cabeçalho: uma célula "Pontos" seguida de >=2 células-ano.
  let headerRowIdx = -1;
  let nameColIdx = -1;
  let yearColIndices: number[] = [];

  for (let r = 0; r < grid.length; r++) {
    const cells = grid[r].map((c) => (c ?? "").trim());
    const pontosIdx = cells.findIndex((c) => normalize(c) === "pontos");
    if (pontosIdx === -1) continue;
    const afterCells = cells.slice(pontosIdx + 1);
    const yearIdxRelative: number[] = [];
    afterCells.forEach((c, i) => { if (/^20\d{2}$/.test(c)) yearIdxRelative.push(pontosIdx + 1 + i); });
    if (yearIdxRelative.length >= 2) {
      headerRowIdx = r;
      nameColIdx = pontosIdx;
      yearColIndices = yearIdxRelative;
      break;
    }
  }

  if (headerRowIdx === -1) {
    warnings.push('Cabeçalho "Pontos / 2021 / 2022 / ..." não encontrado na aba "Totais".');
    return { rows, pointNames: [], warnings };
  }

  const years = yearColIndices.map((idx) => Number(grid[headerRowIdx][idx]));

  let i = headerRowIdx + 1;
  while (i < grid.length) {
    const nameCell = (grid[i]?.[nameColIdx] ?? "").trim();
    const normalized = normalize(nameCell);

    if (normalized === "irpj" || normalized === "csll") break; // fim do bloco de pontos (início do resumo)
    if (!nameCell) { i++; continue; } // linha totalmente vazia entre blocos — avança 1, não 2

    const irpjRow = grid[i] ?? [];
    const csllRow = grid[i + 1] ?? [];

    pointNames.push(nameCell);
    years.forEach((year, yIdx) => {
      const colIdx = yearColIndices[yIdx];
      const irpjValue = parseNumber(irpjRow[colIdx] ?? "");
      const csllValue = parseNumber(csllRow[colIdx] ?? "");
      rows.push({ point_name: nameCell, reference_year: year, tax_sub_type: "IRPJ", value: irpjValue ?? 0 });
      rows.push({ point_name: nameCell, reference_year: year, tax_sub_type: "CSLL", value: csllValue ?? 0 });
    });

    i += 2; // cada ponto = exatamente 2 linhas (IRPJ + CSLL), mesmo que a 2ª esteja em branco
  }

  if (rows.length === 0) warnings.push('Nenhum ponto encontrado na aba "Totais".');

  return { rows, pointNames, warnings };
}


// ═════════════════════════════════════════════════════════════════════════
// INSS — "Importar Pontos INSS". 1 arquivo = N pontos, lidos da aba
// "Totais": cada ponto ocupa UMA linha (nome + um valor por ano — sem
// split, diferente de IR/CSLL). A aba termina numa linha de resumo (nome
// "INSS", geralmente com #REF! em algumas células) — reconhecida porque
// não tem o marcador (ícone) que toda linha de ponto de verdade tem na
// coluna imediatamente à esquerda do nome.
// ═════════════════════════════════════════════════════════════════════════

export interface ParsedInssRow {
  point_name: string;
  reference_year: number;
  value: number;
}

export interface ParseInssTotaisResult {
  rows: ParsedInssRow[];
  /** Nomes dos pontos, na ORDEM em que aparecem no arquivo — importante
   *  para o respaldo por ordem (ver INSS_TOTAIS_TEMPLATE_ORDER abaixo). */
  pointNames: string[];
  warnings: string[];
}

export function parseInssTotais(grid: string[][]): ParseInssTotaisResult {
  const warnings: string[] = [];
  const rows: ParsedInssRow[] = [];
  const pointNames: string[] = [];

  let headerRowIdx = -1;
  let nameColIdx = -1;
  let yearColIndices: number[] = [];

  for (let r = 0; r < grid.length; r++) {
    const cells = grid[r].map((c) => (c ?? "").trim());
    const pontosIdx = cells.findIndex((c) => normalize(c) === "pontos");
    if (pontosIdx === -1) continue;
    const afterCells = cells.slice(pontosIdx + 1);
    const yearIdxRelative: number[] = [];
    afterCells.forEach((c, i) => { if (/^20\d{2}$/.test(c)) yearIdxRelative.push(pontosIdx + 1 + i); });
    if (yearIdxRelative.length >= 2) {
      headerRowIdx = r; nameColIdx = pontosIdx; yearColIndices = yearIdxRelative;
      break;
    }
  }

  if (headerRowIdx === -1) {
    warnings.push('Cabeçalho "Pontos / 2021 / 2022 / ..." não encontrado na aba "Totais".');
    return { rows, pointNames: [], warnings };
  }

  const years = yearColIndices.map((idx) => Number(grid[headerRowIdx][idx]));
  const iconColIdx = nameColIdx - 1; // marcador que toda linha de ponto de verdade tem

  for (let i = headerRowIdx + 1; i < grid.length; i++) {
    const row = grid[i] ?? [];
    const name = (row[nameColIdx] ?? "").trim();
    if (!name) break;

    if (iconColIdx >= 0) {
      const icon = (row[iconColIdx] ?? "").trim();
      if (!icon) break; // sinal principal: sem marcador = fim dos pontos (linha de resumo)
    } else {
      // Sem coluna de ícone disponível (planilha atípica) — usa o próprio
      // nome como sinal de segurança para não importar a linha de resumo.
      const n = normalize(name);
      if (n === "inss" || n === "total") break;
    }

    pointNames.push(name);
    years.forEach((year, yIdx) => {
      const raw = row[yearColIndices[yIdx]] ?? "";
      const value = parseNumber(raw);
      rows.push({ point_name: name, reference_year: year, value: value ?? 0 });
    });
  }

  if (rows.length === 0) warnings.push('Nenhum ponto encontrado na aba "Totais".');

  return { rows, pointNames, warnings };
}

// ─── Ordem canônica dos pontos na planilha-padrão de INSS ("Totais") ────────
//
// Usada SÓ como respaldo opcional (toggle "usar ordem dos pontos" no
// wizard): quando o nome de uma linha não bate com nenhum ponto do
// catálogo, tenta achar o ponto pelo NOME CANÔNICO esperado naquela
// posição — não pela posição crua do catálogo, que pode estar em outra
// ordem. Construída a partir de duas planilhas reais de clientes
// diferentes (mesmo template, mesma ordem nas duas) cruzadas com a base
// "Pontos_Prev". 2 das 81 posições ("Desoneração da Folha" e "Atualização
// Monetária") não têm ponto correspondente no catálogo ainda — o respaldo
// não resolve esses dois, mesmo ligado; precisam de busca manual.
export interface InssTemplateOrderEntry {
  position: number;
  templateName: string;
  /** external_id no catálogo (credit_point_definitions), ou null se esse
   *  ponto do template ainda não existe cadastrado. */
  externalId: string | null;
}

export const INSS_TOTAIS_TEMPLATE_ORDER: InssTemplateOrderEntry[] = [
  { position: 1, templateName: "RATxFAP", externalId: "0111000059" },
  { position: 2, templateName: "Desoneração da Folha", externalId: null },
  { position: 3, templateName: "Retenções", externalId: "0111000054" },
  { position: 4, templateName: "Aviso Prévio Indenizado", externalId: "011100004" },
  { position: 5, templateName: "Salário Maternidade", externalId: "0111000051" },
  { position: 6, templateName: "15 Primeiros Dias de Afastamento", externalId: "011100001" },
  { position: 7, templateName: "Abono Assiduidade", externalId: "011100003" },
  { position: 8, templateName: "Salário Educação", externalId: "0111000058" },
  { position: 9, templateName: "PIS sobre Folha", externalId: "0111000057" },
  { position: 10, templateName: "RAT - Ajuste CBO/CNAE", externalId: "0111000053" },
  { position: 11, templateName: "Pagamento a Maior", externalId: "0111000056" },
  { position: 12, templateName: "Prêmios e Bonificações", externalId: "011100002" },
  { position: 13, templateName: "Férias em Dobro", externalId: "011100005" },
  { position: 14, templateName: "Férias Indenizadas", externalId: "011100006" },
  { position: 15, templateName: "Previdência Privada (Contribuição Patronal)", externalId: "011100007" },
  { position: 16, templateName: "Auxílio Alimentação", externalId: "011100008" },
  { position: 17, templateName: "Auxílio Transporte (Vale-Transporte)", externalId: "011100009" },
  { position: 18, templateName: "Auxílio Refeição", externalId: "0111000010" },
  { position: 19, templateName: "Multa Rescisória (40% FGTS)", externalId: "0111000011" },
  { position: 20, templateName: "Indenização Art. 479", externalId: "0111000013" },
  { position: 21, templateName: "Indenização Safrista", externalId: "0111000014" },
  { position: 22, templateName: "Incentivo à Demissão Voluntária (PDV)", externalId: "0111000015" },
  { position: 23, templateName: "Indenização Adicional da Lei nº 7.238/1984", externalId: "0111000016" },
  { position: 24, templateName: "Licença-Prêmio Indenizada", externalId: "0111000018" },
  { position: 25, templateName: "Abono Pecuniário de Férias", externalId: "0111000019" },
  { position: 26, templateName: "Diárias para Viagem", externalId: "0111000020" },
  { position: 27, templateName: "Ressarcimento de Despesas com Utilização de Veículo Próprio", externalId: "0111000021" },
  { position: 28, templateName: "Auxilio Creche", externalId: "0111000022" },
  { position: 29, templateName: "Reembolso Babá", externalId: "0111000023" },
  { position: 30, templateName: "Assistência Médica", externalId: "0111000024" },
  { position: 31, templateName: "Assistência Odontológica", externalId: "0111000025" },
  { position: 32, templateName: "Reembolso de Despesas Médicas", externalId: "0111000026" },
  { position: 33, templateName: "Reembolso de Medicamentos", externalId: "0111000027" },
  { position: 34, templateName: "Reembolso de Despesas Hospitalares", externalId: "0111000028" },
  { position: 35, templateName: "Fornecimento ou Reembolso de Próteses, Órteses, Aparelhos Ortopédicos, Óculos e Similares", externalId: "0111000029" },
  { position: 36, templateName: "Bolsa Estudo", externalId: "0111000030" },
  { position: 37, templateName: "Auxilio Educação", externalId: "0111000031" },
  { position: 38, templateName: "Programas de Qualificação Profissional", externalId: "0111000032" },
  { position: 39, templateName: "Bolsa Estágio", externalId: "0111000033" },
  { position: 40, templateName: "Bolsa de Ensino, Pesquisa, Extensão e Incentivo à Inovação", externalId: "0111000034" },
  { position: 41, templateName: "Previdência Complementar", externalId: "0111000035" },
  { position: 42, templateName: "Seguro de Vida", externalId: "0111000036" },
  { position: 43, templateName: "PLR", externalId: "0111000037" },
  { position: 44, templateName: "Abonos", externalId: "0111000038" },
  { position: 45, templateName: "Vestuário Fornecido para Execução das Atividades", externalId: "0111000039" },
  { position: 46, templateName: "Uniformes", externalId: "0111000040" },
  { position: 47, templateName: "Equipamentos de Proteção Individual (EPIs)", externalId: "0111000041" },
  { position: 48, templateName: "Ferramentas e Acessórios Fornecidos para Prestação dos Serviços", externalId: "0111000042" },
  { position: 49, templateName: "Alimentação, Transporte e Habitação em Canteiros de Obra ou Locais de Difícil Acesso", externalId: "0111000043" },
  { position: 50, templateName: "Complementação de Auxílio por Incapacidade Temporária", externalId: "0111000044" },
  { position: 51, templateName: "Valores Decorrentes de Cessão de Direitos Autorais", externalId: "0111000045" },
  { position: 52, templateName: "Indenização Multa Art. 477", externalId: "0111000046" },
  { position: 53, templateName: "Auxílio Funeral", externalId: "0111000047" },
  { position: 54, templateName: "Assistência à Família em Razão do Falecimento do Segurado", externalId: "0111000048" },
  { position: 55, templateName: "Vale-Cultura", externalId: "0111000049" },
  { position: 56, templateName: "Auxílio-Inclusão da Pessoa com Deficiência", externalId: "0111000050" },
  { position: 57, templateName: "Prorrogação do Salário-Maternidade", externalId: "0111000055" },
  { position: 58, templateName: "Ajuda de Custos", externalId: "0111000052" },
  { position: 59, templateName: "Atualização Monetária", externalId: null },
  { position: 60, templateName: "Licença Paternidade", externalId: "0111000061" },
  { position: 61, templateName: "Bonus Retenção", externalId: "0111000062" },
  { position: 62, templateName: "Stock Options", externalId: "0111000063" },
  { position: 63, templateName: "Horas Extras", externalId: "0111000064" },
  { position: 64, templateName: "RAT Sem Exposição ao Risco Laboral", externalId: "0111000065" },
  { position: 65, templateName: "Descontos Vale Transporte", externalId: "0111000066" },
  { position: 66, templateName: "Descontos Vale Alimentação", externalId: "0111000067" },
  { position: 67, templateName: "Desconto de Academias e Programas de Bem-Estar", externalId: "0111000068" },
  { position: 68, templateName: "Desconto de Convênio Farmácia", externalId: "0111000069" },
  { position: 69, templateName: "Desconto de Seguro de Vida", externalId: "0111000070" },
  { position: 70, templateName: "Desconto de Previdência Privada", externalId: "0111000071" },
  { position: 71, templateName: "Desconto de Clubes e Associações", externalId: "0111000072" },
  { position: 72, templateName: "Desconto de Convênios Educacionais", externalId: "0111000073" },
  { position: 73, templateName: "Desconto de Convênios com Óticas", externalId: "0111000074" },
  { position: 74, templateName: "13º Sobre Aviso Prévio Indenizado", externalId: "0111000075" },
  { position: 75, templateName: "Adicional Noturno", externalId: "0111000080" },
  { position: 76, templateName: "Adicional de Insalubridade", externalId: "0111000081" },
  { position: 77, templateName: "Entidades Parafiscais", externalId: "0111000077" },
  { position: 78, templateName: "Descontos INSS", externalId: "0111000078" },
  { position: 79, templateName: "Descontos IRRF", externalId: "0111000078" },
  { position: 80, templateName: "Descontos Assistência Médica/Odontológica", externalId: "0111000079" },
  { position: 81, templateName: "Sistema 4S's", externalId: "0111000076" },
];