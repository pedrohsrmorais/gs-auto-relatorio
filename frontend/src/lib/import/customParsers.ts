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