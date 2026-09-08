import * as XLSX from "xlsx";
import type { ImportColumnDef, ImportTableConfig, ImportValidationRow, ImportPreviewResult } from "./importConfigs";

export async function parseXlsxFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  const [headerRow, ...dataRows] = matrix;
  return {
    headers: (headerRow ?? []).map((h) => String(h ?? "").trim()),
    rows: dataRows
      .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
      .map((r) => r.map((c) => String(c ?? ""))),
  };
}

export function parsePastedText(text: string): { headers: string[]; rows: string[][] } {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return { headers: [], rows: [] };
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  const [headerLine, ...dataLines] = lines;
  return {
    headers: headerLine.split(delimiter).map((h) => h.trim()),
    rows: dataLines.map((l) => l.split(delimiter).map((c) => c.trim())),
  };
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

// M400/M610 costumam vir com ANO e MÊS em colunas separadas.
// Junta as duas numa coluna sintética "Competência (Ano/Mês)" antes do mapeamento.
export function preprocessCompositeDateColumns(
  headers: string[],
  rows: string[][]
): { headers: string[]; rows: string[][] } {
  const yearIdx = headers.findIndex((h) => normalize(h) === "ano");
  const monthIdx = headers.findIndex((h) => ["mes", "mês"].includes(normalize(h)));
  if (yearIdx === -1 || monthIdx === -1) return { headers, rows };

  const newHeaders = [...headers, "Competência (Ano/Mês)"];
  const newRows = rows.map((r) => {
    const year = (r[yearIdx] ?? "").trim();
    const month = (r[monthIdx] ?? "").trim().padStart(2, "0");
    const combined = year && month ? `${year}-${month}-01` : "";
    return [...r, combined];
  });
  return { headers: newHeaders, rows: newRows };
}

function normalizeKey(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}

/**
 * Mapeamento automático por nome de coluna. Duas passadas:
 * 1) igualdade exata (após normalização);
 * 2) contenção (cobre casos como "LABEL [CODIGO]" que não bateram exato).
 * `usedIndexes` evita que duas colunas de destino apontem pro mesmo índice de origem.
 */
export function autoMapColumns(headers: string[], columns: ImportColumnDef[]): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  const normalizedHeaders = headers.map(normalizeKey);
  const usedIndexes = new Set<number>();

  for (const col of columns) {
    const candidates = [col.label, col.key, ...col.aliases].map(normalizeKey).filter(Boolean);

    let idx = normalizedHeaders.findIndex((h, i) => !usedIndexes.has(i) && candidates.includes(h));

    if (idx === -1) {
      idx = normalizedHeaders.findIndex((h, i) => {
        if (usedIndexes.has(i) || !h) return false;
        return candidates.some((c) => c.length > 3 && (h.includes(c) || c.includes(h)));
      });
    }

    if (idx >= 0) usedIndexes.add(idx);
    mapping[col.key] = idx >= 0 ? idx : null;
  }

  return mapping;
}

/**
 * Mapeamento posicional/manual: ignora nomes de cabeçalho e assume que a
 * N-ésima coluna do arquivo corresponde exatamente à N-ésima coluna definida
 * na config (na mesma ordem declarada em `config.columns`).
 * Usado quando o usuário ativa o checkbox "Mapear pela ordem das colunas".
 */
export function mapColumnsByOrder(headers: string[], columns: ImportColumnDef[]): Record<string, number | null> {
  const mapping: Record<string, number | null> = {};
  columns.forEach((col, i) => {
    mapping[col.key] = i < headers.length ? i : null;
  });
  return mapping;
}

function coerceValue(raw: string, col: ImportColumnDef): { value: unknown; error?: string } {
  const trimmed = (raw ?? "").trim();
  if (trimmed === "") {
    return col.required ? { value: null, error: `${col.label} é obrigatório` } : { value: null };
  }
  switch (col.type) {
    case "number": {
      const cleaned = trimmed.replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
      const n = Number(cleaned);
      return Number.isNaN(n) ? { value: null, error: `${col.label} inválido: "${raw}"` } : { value: n };
    }
    case "date": {
      const d = parseFlexibleDate(trimmed);
      return d ? { value: d } : { value: null, error: `${col.label} com data inválida: "${raw}"` };
    }
    case "enum": {
      const match = col.enumValues?.find((v) => normalize(v) === normalize(trimmed));
      return match
        ? { value: match }
        : { value: trimmed, error: `${col.label}: valor "${raw}" fora da lista esperada` };
    }
    default:
      return { value: trimmed };
  }
}

function parseFlexibleDate(raw: string): string | null {
  const br = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  const iso = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return raw;
  const monthYear = raw.match(/^(\d{2})\/(\d{4})$/);
  if (monthYear) return `${monthYear[2]}-${monthYear[1]}-01`;
  return null;
}

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
      const rawValue = idx !== null && idx !== undefined ? raw[idx] ?? "" : "";
      const { value, error } = coerceValue(rawValue, col);
      data[col.key] = value;
      if (error) messages.push(error);
    }
    return {
      rowIndex,
      status: messages.length === 0 ? "ok" : messages.some((m) => m.includes("obrigatório")) ? "error" : "warning",
      messages,
      data,
    };
  });

  return {
    columns: config.columns.map((c) => c.key),
    totalRows: rows.length,
    validRows: rows.filter((r) => r.status !== "error").length,
    errorRows: rows.filter((r) => r.status === "error").length,
    rows,
  };
}

export async function parseXlsxRawMatrix(file: File): Promise<string[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" });
  return matrix
    .filter((r) => r.some((c) => String(c ?? "").trim() !== ""))
    .map((r) => r.map((c) => String(c ?? "")));
}

export function parsePastedMatrix(text: string): string[][] {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return [];
  const delimiter = lines[0].includes("\t") ? "\t" : lines[0].includes(";") ? ";" : ",";
  return lines.map((l) => l.split(delimiter).map((c) => c.trim()));
}