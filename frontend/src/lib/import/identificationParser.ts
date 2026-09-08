export interface ParsedJobIdentification {
  job_number: string | null;
  company_name: string | null;
  segment: string | null;
  tax_regime: "Lucro Real" | "Lucro Presumido" | "Simples Nacional" | "Lucro Arbitrado" | null;
}

function normalize(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}
function normalizeKey(s: string): string {
  return normalize(s).replace(/[^a-z0-9]/g, "");
}

const REGIME_MAP: Record<string, ParsedJobIdentification["tax_regime"]> = {
  lucroreal: "Lucro Real",
  lucropresumido: "Lucro Presumido",
  simplesnacional: "Simples Nacional",
  lucroarbitrado: "Lucro Arbitrado",
};

/** Lê apenas as colunas de identificação do Relatório 1 (as demais ~45 colunas são ignoradas aqui). */
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