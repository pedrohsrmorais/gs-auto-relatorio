// ─────────────────────────────────────────────────────────────────────────────
// parseUtils.ts
//
// Utilitários de leitura/normalização de planilhas para o ImportWizard.
// Cobre: leitura de .xlsx, parsing de texto colado do Excel, auto-mapeamento
// de colunas por nome de cabeçalho, mapeamento por ordem, mesclagem de
// colunas ANO+MES em uma data única, e montagem do preview de importação.
//
// `parseNumber` é exportado (antes era privado) porque é a única lógica de
// "texto → número" que deve existir no projeto — customParsers.ts a
// reaproveita em vez de ter sua própria conversão (que tinha um bug: veja
// a nota na função).
// ─────────────────────────────────────────────────────────────────────────────

import * as XLSX from "xlsx";
import type { ImportColumnDef, ImportPreviewResult, ImportTableConfig, ImportValidationRow } from "./importConfigs";

// ─── Normalização de texto (para comparação de cabeçalhos) ───────────────────

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// ─── Leitura de arquivo .xlsx ─────────────────────────────────────────────────

/**
 * Lê um arquivo .xlsx e retorna { headers, rows } a partir da linha `headerRow`
 * (1-based). Linhas antes de headerRow (metadados) são descartadas.
 */
export async function parseXlsxFile(
  file: File,
  headerRow = 1
): Promise<{ headers: string[]; rows: string[][] }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  // Converte a planilha inteira em matriz de strings, célula a célula.
  const matrix: string[][] = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  const headerIdx = Math.max(0, headerRow - 1);
  const headerLine = matrix[headerIdx] ?? [];
  const dataLines = matrix.slice(headerIdx + 1);

  const headers = headerLine.map((h) => String(h ?? "").trim());
  const rows = dataLines
    .map((r) => headers.map((_, i) => String(r[i] ?? "").trim()))
    .filter((r) => r.some((c) => c !== ""));

  return { headers, rows };
}

/**
 * Lê um arquivo .xlsx como matriz bruta de strings, sem separar cabeçalho —
 * usado pelo parser de matriz de pontos (customParsers.ts), que precisa
 * varrer linha a linha procurando marcadores como ID_PONTO/ID_TRIBUTO em
 * posições variáveis. Linhas totalmente em branco são descartadas
 * (blankrows: false) — adequado para ADM/FTX e IPI, onde uma linha vazia
 * nunca carrega dado válido.
 */
export async function parseXlsxRawMatrix(file: File): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];

  const matrix: string[][] = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: false,
  });

  return matrix.map((row) => row.map((c) => String(c ?? "").trim()));
}

/**
 * Lê uma aba específica (por nome, primeira correspondência case-insensitive
 * dentre `sheetNameCandidates`) como matriz bruta de strings, PRESERVANDO
 * linhas em branco (blankrows: true).
 *
 * Usado pelo parser de IR/CSLL (parseIrCsllTotais): na aba "Totais", cada
 * ponto ocupa exatamente 2 linhas (IRPJ + CSLL) e a linha de CSLL pode ficar
 * totalmente vazia quando o valor é nulo — se essa linha fosse descartada
 * (como em parseXlsxRawMatrix), o pareamento de todos os pontos seguintes
 * desalinharia. Por isso este leitor NUNCA deve usar blankrows: false.
 */
export async function parseXlsxNamedSheetMatrixKeepBlanks(
  file: File,
  sheetNameCandidates: string[]
): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array", cellDates: true });

  const found = workbook.SheetNames.find((n) =>
    sheetNameCandidates.some((c) => n.trim().toLowerCase() === c.trim().toLowerCase())
  );
  if (!found) {
    throw new Error(`Aba não encontrada no arquivo. Esperado uma de: ${sheetNameCandidates.join(", ")}.`);
  }
  const sheet = workbook.Sheets[found];

  const matrix: string[][] = XLSX.utils.sheet_to_json<string[]>(sheet, {
    header: 1,
    raw: false,
    defval: "",
    blankrows: true,
  });

  return matrix.map((row) => (row ?? []).map((c) => String(c ?? "").trim()));
}

// ─── Parsing de texto colado do Excel (TSV) ──────────────────────────────────

/**
 * Interpreta texto colado (TSV, como copiado do Excel) a partir da linha
 * `headerRow` (1-based). Linhas em branco são ignoradas na contagem.
 */
export function parsePastedText(
  text: string,
  headerRow = 1
): { headers: string[]; rows: string[][] } {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.split("\t").map((c) => c.trim()))
    .filter((l) => l.some((c) => c !== ""));

  const headerIdx = Math.max(0, headerRow - 1);
  const headers = lines[headerIdx] ?? [];
  const dataLines = lines.slice(headerIdx + 1);

  const rows = dataLines.map((r) => headers.map((_, i) => r[i] ?? ""));

  return { headers, rows };
}

/**
 * Interpreta texto colado (TSV) como matriz bruta, sem separar cabeçalho —
 * contraparte de parseXlsxRawMatrix para quando o usuário cola em vez de
 * enviar arquivo (fluxo de pontos ADM/FTX/IPI).
 */
export function parsePastedMatrix(text: string): string[][] {
  return text
    .replace(/\r/g, "")
    .split("\n")
    .map((l) => l.split("\t").map((c) => c.trim()))
    .filter((l) => l.some((c) => c !== ""));
}

// ─── Mesclagem de colunas compostas (ANO + MES → reference_month) ────────────

/**
 * Algumas planilhas (M400/M610) trazem ANO e MES em colunas separadas.
 * Esta função detecta esse padrão e insere uma coluna sintética
 * "reference_month" (formato YYYY-MM-01) logo após elas, para que o
 * mapeamento de colunas trate normalmente como uma única data.
 */
export function preprocessCompositeDateColumns(
  headers: string[],
  rows: string[][]
): { headers: string[]; rows: string[][] } {
  const anoIdx = headers.findIndex((h) => normalize(h) === "ano");
  const mesIdx = headers.findIndex((h) => normalize(h) === "mes" || normalize(h) === "mês");

  if (anoIdx === -1 || mesIdx === -1) {
    return { headers, rows };
  }

  const newHeaders = [...headers, "reference_month"];
  const newRows = rows.map((r) => {
    const ano = String(r[anoIdx] ?? "").trim();
    const mes = String(r[mesIdx] ?? "").trim().padStart(2, "0");
    const refMonth = ano && mes ? `${ano}-${mes}-01` : "";
    return [...r, refMonth];
  });

  return { headers: newHeaders, rows: newRows };
}

// ─── Auto-mapeamento de colunas por nome de cabeçalho ────────────────────────

/**
 * Para cada coluna esperada (config.columns), tenta encontrar o índice da
 * coluna correspondente no cabeçalho da planilha, comparando o nome
 * normalizado e os matchHints configurados.
 */
export function autoMapColumns(
  headers: string[],
  columns: ImportColumnDef[]
): Record<string, number | null> {
  const normalizedHeaders = headers.map(normalize);
  const mapping: Record<string, number | null> = {};

  for (const col of columns) {
    const candidates = [col.label, col.key, ...(col.matchHints ?? [])].map(normalize);
    let foundIdx: number | null = null;

    // 1. Match exato do header normalizado com algum candidato
    for (let i = 0; i < normalizedHeaders.length; i++) {
      if (candidates.includes(normalizedHeaders[i])) {
        foundIdx = i;
        break;
      }
    }

    // 2. Match parcial (header contém o candidato ou vice-versa)
    if (foundIdx === null) {
      for (let i = 0; i < normalizedHeaders.length; i++) {
        const h = normalizedHeaders[i];
        if (candidates.some((c) => c.length > 2 && (h.includes(c) || c.includes(h)))) {
          foundIdx = i;
          break;
        }
      }
    }

    mapping[col.key] = foundIdx;
  }

  return mapping;
}

/**
 * Mapeia colunas pela ordem posicional: a 1ª coluna da planilha vira o 1º
 * campo da config, a 2ª vira o 2º, etc. Ignora nomes de cabeçalho.
 */
export function mapColumnsByOrder(
  headers: string[],
  columns: ImportColumnDef[]
): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  columns.forEach((col, i) => {
    mapping[col.key] = i < headers.length ? i : null;
  });
  return mapping;
}

// ─── Conversão de valores por tipo ────────────────────────────────────────────

/**
 * Converte texto de célula em número, tratando os formatos que aparecem nas
 * planilhas do sistema:
 *   - "15.779,00" (BR: milhar ".", decimal ",")         → 15779.00
 *   - "15,779.00" (US: milhar ",", decimal ".")         → 15779.00
 *   - "15779.00" ou "0.85" (decimal "." direto, sem milhar) → 15779.00 / 0.85
 *   - " -   " (traço usado como "zero" em formato contábil)  → 0
 *
 * A tabela "Totais" da planilha de IR/CSLL usa formato US (ex.: "3,167.19",
 * "12,905.85"), enquanto a maioria das outras planilhas do sistema usa BR
 * (ex.: "15.779,00") — por isso os dois padrões precisam ser reconhecidos
 * explicitamente antes de cair num fallback ambíguo.
 *
 * Retorna null se o texto não for um número válido (em vez de 0), para que
 * quem chama decida se isso é erro ou "sem valor" — EXCETO o traço "-"
 * (isolado, com ou sem espaços ao redor), que é sempre 0: é assim que este
 * sistema formata contabilmente um valor zero (visto em todas as planilhas
 * "Padrão" e nos resumos already existentes na plataforma).
 */
export function parseNumber(raw: string): number | null {
  if (raw === "" || raw === undefined || raw === null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (trimmed === "-") return 0; // "-" isolado = zero contábil

  let s = trimmed;

  if (/^-?\d{1,3}(\.\d{3})*(,\d+)?$/.test(s)) {
    // BR: "15.779,00" ou "1.234"
    s = s.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d{1,3}(,\d{3})*(\.\d+)?$/.test(s)) {
    // US: "15,779.00" ou "1,234"
    s = s.replace(/,/g, "");
  } else {
    // Fallback ambíguo (um único separador, ex. "0,85" ou "0.85"): assume
    // vírgula como decimal (convenção BR), ponto já é decimal nativo do JS.
    s = s.replace(",", ".");
  }

  const n = Number(s);
  return isNaN(n) ? null : n;
}

/**
 * Interpreta datas em "DD/MM/YYYY" (ou "M/D/YY" quando um dos números é
 * claramente > 12, o que só é possível como dia). Também aceita ISO
 * (YYYY-MM-DD) direto.
 *
 * IMPORTANTE — ambiguidade: "1/2/21" pode ser 1º de fevereiro (DD/MM) ou
 * 2 de janeiro (MM/DD) e não há como saber com certeza sem contexto da
 * planilha de origem. Quando os dois números são <= 12, assumimos
 * DD/MM/YYYY (padrão brasileiro, usado na maioria das planilhas deste
 * sistema). Quando um dos dois é > 12, ele só pode ser o dia, então a
 * interpretação é inequívoca.
 */
function parseDateFlexible(raw: string): string | null {
  if (!raw) return null;
  const s = raw.trim();

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  const match = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (!match) return null;

  const [, firstRaw, secondRaw, yearRaw] = match;
  const first = Number(firstRaw);
  const second = Number(secondRaw);
  const year = yearRaw.length === 2 ? `20${yearRaw}` : yearRaw;

  let day: number;
  let month: number;
  if (first > 12 && second <= 12) {
    day = first; month = second; // só pode ser D/M/Y
  } else if (second > 12 && first <= 12) {
    month = first; day = second; // só pode ser M/D/Y
  } else {
    day = first; month = second; // ambíguo — assume D/M/Y
  }

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

// ─── Montagem do preview ──────────────────────────────────────────────────────

export function buildPreview(
  config: ImportTableConfig,
  headers: string[],
  rawRows: string[][],
  mapping: Record<string, number | null>
): ImportPreviewResult {
  const rows: ImportValidationRow[] = rawRows.map((raw, rowIndex) => {
    const data: Record<string, unknown> = {};
    const messages: string[] = [];

    for (const col of config.columns) {
      const idx = mapping[col.key];
      const rawValue = idx !== null && idx !== undefined ? (raw[idx] ?? "") : "";

      if (col.required && !rawValue) {
        messages.push(`${col.label} é obrigatório`);
        data[col.key] = null;
        continue;
      }

      switch (col.kind) {
        case "number": {
          const n = parseNumber(rawValue);
          if (rawValue && n === null) messages.push(`${col.label}: valor numérico inválido ("${rawValue}")`);
          data[col.key] = n ?? 0;
          break;
        }
        case "date": {
          const d = parseDateFlexible(rawValue);
          if (rawValue && !d) messages.push(`${col.label}: data inválida ("${rawValue}")`);
          data[col.key] = d;
          break;
        }
        case "month_period": {
          // Já vem pronto de preprocessCompositeDateColumns (YYYY-MM-01),
          // ou pode ser uma data completa também aceitável.
          const d = /^\d{4}-\d{2}-\d{2}$/.test(rawValue) ? rawValue : parseDateFlexible(rawValue);
          if (!d && col.required) messages.push(`${col.label}: mês/ano inválido ("${rawValue}")`);
          data[col.key] = d;
          break;
        }
        case "enum": {
          if (rawValue && col.enumValues && !col.enumValues.includes(rawValue.toUpperCase())) {
            messages.push(`${col.label}: valor "${rawValue}" não reconhecido`);
          }
          data[col.key] = rawValue ? rawValue.toUpperCase() : null;
          break;
        }
        case "text":
        default:
          data[col.key] = rawValue || null;
      }
    }

    return {
      rowIndex,
      status: messages.length > 0 ? "error" : "ok",
      messages,
      data,
    };
  });

  const validRows = rows.filter((r) => r.status !== "error").length;

  return {
    totalRows: rows.length,
    validRows,
    errorRows: rows.length - validRows,
    rows,
  };
}