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

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function toNumber(raw: string): number {
  if (!raw) return 0;
  const cleaned = raw.trim().replace(/\./g, "").replace(",", ".").replace(/[^\d.-]/g, "");
  if (cleaned === "" || cleaned === "-") return 0;
  const n = Number(cleaned);
  return Number.isNaN(n) ? 0 : n;
}

const MONTH_COUNT = 12;

/**
 * Varre um bloco colado/enviado no formato "Importar" (ID_TRIBUTO, ID_PONTO,
 * seguido de linhas ano + 12 meses + marcador P/C). Tolerante a pequenas
 * variações de espaçamento — não depende de letras de coluna fixas.
 */
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
      const value = valueCell ? Number(valueCell.replace(/\D/g, "")) : NaN;
      if (!Number.isNaN(value)) {
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
      rawRows.push({
        point_name: pointNameHint ?? null,
        external_tax_id: externalTaxId,
        reference_month: `${year}-${String(m + 1).padStart(2, "0")}-01`,
        contribution,
        value: toNumber(raw),
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