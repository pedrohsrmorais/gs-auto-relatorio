export interface ParsedCategoriaRow {
  risk_color: "VERDE" | "AMARELO" | "VERMELHO";
  tax_name: string;
  point_name: string;
  reference_year: number;
  value: number;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function normalizeKey(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}
function toNumber(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

const RISK_COLORS = ["VERDE", "AMARELO", "VERMELHO"];

/** Colunas fixas (COR, NOME TRIBUTO, NOME PONTO) + N colunas de ano dinâmicas. */
export function parseCategoriaGrid(
  headers: string[],
  rows: string[][]
): { rows: ParsedCategoriaRow[]; warnings: string[] } {
  const warnings: string[] = [];
  const normalizedHeaders = headers.map(normalizeKey);

  const corIdx = normalizedHeaders.findIndex((h) => h === "cor");
  const tributoIdx = normalizedHeaders.findIndex((h) => h === "nometributo" || h === "tributo");
  const pontoIdx = normalizedHeaders.findIndex((h) => h === "nomeponto" || h === "ponto");

  const yearColumns: { index: number; year: number }[] = [];
  headers.forEach((h, i) => {
    const match = h.trim().match(/^(20\d{2})$/);
    if (match) yearColumns.push({ index: i, year: Number(match[1]) });
  });

  if (corIdx === -1 || tributoIdx === -1 || pontoIdx === -1) {
    warnings.push("Não foi possível identificar as colunas COR, NOME TRIBUTO ou NOME PONTO.");
  }
  if (yearColumns.length === 0) {
    warnings.push("Nenhuma coluna de ano (ex: 2024) foi encontrada no cabeçalho.");
  }

  const output: ParsedCategoriaRow[] = [];
  for (const raw of rows) {
    const colorRaw = (raw[corIdx] ?? "").trim().toUpperCase();
    const color = RISK_COLORS.find((c) => c === colorRaw);
    const taxName = (raw[tributoIdx] ?? "").trim();
    const pointName = (raw[pontoIdx] ?? "").trim();
    if (!color || !taxName || !pointName) continue;

    for (const { index, year } of yearColumns) {
      const cellRaw = raw[index] ?? "";
      if (cellRaw.trim() === "") continue;
      output.push({
        risk_color: color as ParsedCategoriaRow["risk_color"],
        tax_name: taxName,
        point_name: pointName,
        reference_year: year,
        value: toNumber(cellRaw),
      });
    }
  }

  return { rows: output, warnings };
}