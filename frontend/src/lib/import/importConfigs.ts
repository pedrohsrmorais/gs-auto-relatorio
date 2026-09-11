// ─────────────────────────────────────────────────────────────────────────────
// importConfigs.ts
//
// Define, para cada tabela bruta importável, quais colunas existem, como
// mapeá-las a partir do cabeçalho da planilha, e como validar/converter cada
// valor. Usado pelo ImportWizard genérico (PERDCOMP, DARF, M400, M610).
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnKind = "text" | "number" | "date" | "month_period" | "enum";

export interface ImportColumnDef {
  /** chave enviada ao backend, bate com a coluna da tabela SQL */
  key: string;
  /** rótulo mostrado na etapa de mapeamento/preview */
  label: string;
  kind: ColumnKind;
  required?: boolean;
  /** valores aceitos, quando kind === "enum" */
  enumValues?: string[];
  /** termos usados no auto-mapeamento por nome de cabeçalho (case/acento-insensitive) */
  matchHints?: string[];
}

export interface ImportTableConfig {
  id: string;
  title: string;
  description?: string;
  columns: ImportColumnDef[];
  /**
   * Linha (1-based) onde estão os cabeçalhos das colunas.
   * Padrão: 1 (primeira linha já é o header).
   * As planilhas exportadas do sistema fiscal (DARF/M400/M610) trazem um
   * bloco de metadados (Empresa/Usuário/Data/Cruzamento/Código/Caminho) nas
   * linhas 1–6, uma linha em branco, e o cabeçalho real na linha 8.
   */
  defaultHeaderRow?: number;
}

// Status de uma linha após validação. "warning" existe para uso futuro
// (nenhuma regra de buildPreview emite isso hoje, mas DataPreviewTable já
// sabe renderizar esse estado).
export type ImportRowStatus = "ok" | "warning" | "error";

// Formato de linha usado tanto no preview de importação (buildPreview, em
// parseUtils.ts) quanto na visualização de dados já importados
// (DataViewerModal.tsx, que monta esse mesmo formato manualmente a partir
// dos registros vindos da API). As duas pontas precisam bater exatamente.
export interface ImportValidationRow {
  rowIndex: number;
  status: ImportRowStatus;
  messages: string[];
  data: Record<string, unknown>;
}

export interface ImportPreviewResult {
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: ImportValidationRow[];
}

// ─── PER/DCOMP ────────────────────────────────────────────────────────────────
// Corresponde a job_perdcomps

export const PERDCOMP_CONFIG: ImportTableConfig = {
  id: "perdcomp",
  title: "PER/DCOMP",
  description: "Pedidos de restituição/compensação transmitidos pelo cliente.",
  columns: [
    { key: "perdcomp_number", label: "Número do PER/DCOMP", kind: "text", required: true,
      matchHints: ["numero", "número", "perdcomp"] },
    { key: "transmission_date", label: "Data de transmissão", kind: "date",
      matchHints: ["data", "transmissao", "transmissão"] },
    { key: "credit_type", label: "Tipo de crédito", kind: "text",
      matchHints: ["tipo de credito", "tipo de crédito", "credit_type"] },
    { key: "document_type", label: "Tipo de documento", kind: "text",
      matchHints: ["tipo de documento", "documento"] },
    { key: "status", label: "Status", kind: "enum",
      enumValues: ["EM_ANALISE", "HOMOLOGADA", "NAO_HOMOLOGADA", "CANCELADA", "RETIFICADA"],
      matchHints: ["status", "situacao", "situação"] },
  ],
};

// ─── DARF ─────────────────────────────────────────────────────────────────────
// Corresponde a job_darf_entries

export const DARF_CONFIG: ImportTableConfig = {
  id: "darf",
  title: "DARF",
  description: "Documentos de arrecadação (recolhimentos) por período de apuração.",
  defaultHeaderRow: 8,
  columns: [
    { key: "assessment_period", label: "Período de apuração", kind: "text", required: true,
      matchHints: ["periodo_apuracao", "periodo de apuracao", "período de apuração"] },
    { key: "darf_code", label: "DARF", kind: "text",
      matchHints: ["darf"] },
    { key: "collection_date", label: "Data de arrecadação", kind: "date",
      matchHints: ["data_arrecadacao", "data de arrecadação", "data arrecadacao"] },
    { key: "due_date", label: "Data de vencimento", kind: "date",
      matchHints: ["data_vencimento", "data de vencimento"] },
    { key: "revenue_code", label: "Código da receita", kind: "text",
      matchHints: ["codigo_receita", "código de receita", "cod receita"] },
    { key: "name", label: "Nome (descrição da receita)", kind: "text",
      matchHints: ["nome"] },
    { key: "document_number", label: "Número do documento", kind: "text",
      matchHints: ["numero_documento", "número do documento"] },
    { key: "total_value", label: "Valor total", kind: "number", required: true,
      matchHints: ["valor total", "total"] },
    { key: "days_late", label: "Dias em atraso", kind: "number",
      matchHints: ["dias", "atraso"] },
    { key: "principal_value", label: "Valor principal", kind: "number",
      matchHints: ["principal"] },
    { key: "fine_value", label: "Valor da multa", kind: "number",
      matchHints: ["multa"] },
    { key: "interest_value", label: "Valor dos juros", kind: "number",
      matchHints: ["juros"] },
    { key: "tax_group", label: "Grupo do tributo", kind: "text",
      matchHints: ["grupo_tributo", "grupo do tributo", "grupo tributo"] },
    { key: "cnpj", label: "CNPJ", kind: "text",
      matchHints: ["cnpj"] },
  ],
};

// ─── SPED M400 ────────────────────────────────────────────────────────────────
// Corresponde a job_sped_m400_entries. Planilha traz ANO e MES separados —
// são mesclados em reference_month por preprocessCompositeDateColumns, que
// cria uma coluna sintética com esse nome literal no fim do cabeçalho.
//
// IMPORTANTE: os matchHints de "reference_month" NÃO devem incluir "ano"/
// "mes"/"mês". Se incluíssem, o auto-mapeamento (que varre os headers em
// ordem e para no primeiro candidato que bate) encontraria a coluna
// original "ano" — que vem ANTES da coluna sintética no array — e mapearia
// reference_month para o valor cru do ano (ex: "2021"), que não é uma data
// válida. Isso fazia toda linha do M400/M610 cair como erro na revisão.

export const M400_CONFIG: ImportTableConfig = {
  id: "sped-m400",
  title: "SPED — Registro M400",
  description: "Receitas isentas, não alcançadas ou com alíquota zero/suspensão (PIS/COFINS).",
  defaultHeaderRow: 8,
  columns: [
    { key: "reference_month", label: "Mês de referência", kind: "month_period", required: true },
    { key: "establishment", label: "Estabelecimento", kind: "text",
      matchHints: ["estabelecimento"] },
    { key: "reg", label: "REG", kind: "text",
      matchHints: ["reg"] },
    { key: "cst", label: "Código de situação tributária (CST)", kind: "text",
      matchHints: ["codigo de situacao tributaria", "código de situação tributária", "cst"] },
    { key: "gross_revenue_value", label: "Valor total da receita", kind: "number", required: true,
      matchHints: ["valor total da receita", "valor da receita"] },
    { key: "accounting_account_code", label: "Código da conta contábil", kind: "text",
      matchHints: ["conta contabil", "conta contábil", "codigo da conta"] },
    { key: "revenue_description", label: "Descrição da receita", kind: "text",
      matchHints: ["descricao da receita", "descrição"] },
    { key: "bookkeeping_type", label: "Tipo de escrituração", kind: "text",
      matchHints: ["tipo_escrit", "tipo de escrituracao", "tipo de escrituração"] },
  ],
};

// ─── SPED M610 ────────────────────────────────────────────────────────────────
// Corresponde a job_sped_m610_entries. Também tem ANO/MES separados — mesma
// observação sobre matchHints de reference_month que no M400 acima.

export const M610_CONFIG: ImportTableConfig = {
  id: "sped-m610",
  title: "SPED — Registro M610",
  description: "Detalhamento da contribuição para a Seguridade Social (COFINS) do período.",
  defaultHeaderRow: 8,
  columns: [
    { key: "reference_month", label: "Mês de referência", kind: "month_period", required: true },
    { key: "establishment", label: "Estabelecimento", kind: "text",
      matchHints: ["estabelecimento"] },
    { key: "contribution_code", label: "Código da contribuição (COD_CONT)", kind: "text",
      matchHints: ["codigo contribuicao social", "código contribuição social", "cod_cont"] },
    { key: "contribution_description", label: "Descrição da contribuição", kind: "text",
      matchHints: ["descricao da contribuicao", "descrição da contribuição"] },
    { key: "gross_revenue_value", label: "Receita bruta (VL_REC_BRT)", kind: "number",
      matchHints: ["receita bruta", "vl_rec_brt"] },
    { key: "calculation_base_value", label: "Base de cálculo (VL_BC_CONT)", kind: "number",
      matchHints: ["base de calculo", "base de cálculo", "vl_bc_cont"] },
    { key: "pis_aliquot", label: "Alíquota (ALIQ_PISA)", kind: "number",
      matchHints: ["aliquota", "alíquota", "aliq_pisa"] },
    { key: "pis_quantity", label: "Quantidade (QUANT_BC_PIS)", kind: "number",
      matchHints: ["quantidade", "quant_bc_pis"] },
    { key: "pis_quantity_aliquot", label: "Alíquota por quantidade (ALIQ_PIS_QUANT)", kind: "number",
      matchHints: ["aliquota quantidade", "aliq_pis_quant"] },
    { key: "total_contribution_calculated", label: "Contribuição apurada (VL_CONT_APUR)", kind: "number", required: true,
      matchHints: ["contribuicao apurada", "vl_cont_apur"] },
    { key: "addition_adjustments_value", label: "Ajustes de acréscimo (VL_AJUS_ACRES)", kind: "number",
      matchHints: ["ajustes de acrescimo", "vl_ajus_acres"] },
    { key: "reduction_adjustments_value", label: "Ajustes de redução (VL_AJUS_REDUC)", kind: "number",
      matchHints: ["ajustes de reducao", "vl_ajus_reduc"] },
    { key: "deferred_contribution_value", label: "Contribuição diferida (VL_CONT_DIFER)", kind: "number",
      matchHints: ["contribuicao diferida", "vl_cont_difer"] },
    { key: "previous_deferred_contribution_value", label: "Contrib. diferida anterior (VL_CONT_DIFER_ANT)", kind: "number",
      matchHints: ["diferida anterior", "vl_cont_difer_ant"] },
    { key: "total_period_contribution_value", label: "Contribuição do período (VL_CONT_PER)", kind: "number",
      matchHints: ["contribuicao do periodo", "vl_cont_per"] },
    { key: "bookkeeping_type", label: "Tipo de escrituração", kind: "text",
      matchHints: ["tipo de escrituracao", "tipo de escrituração"] },
  ],
};

export const ALL_IMPORT_CONFIGS: ImportTableConfig[] = [
  PERDCOMP_CONFIG, DARF_CONFIG, M400_CONFIG, M610_CONFIG,
];
