// ─────────────────────────────────────────────────────────────────────────────
// importConfigs.ts
//
// Define, para cada tabela bruta importável, quais colunas existem, como
// mapeá-las a partir do cabeçalho da planilha, e como validar/converter cada
// valor. Usado pelo ImportWizard genérico (PERDCOMP, DARF, M400, M610).
//
// IMPORTANTE sobre "kind: 'ignore'" e a ordem dos campos abaixo:
//
// O wizard tem duas formas de mapear colunas: por NOME de cabeçalho
// (autoMapColumns) e por ORDEM POSICIONAL (mapColumnsByOrder, ligado pelo
// toggle "Mapear pela ordem das colunas"). Mapeamento por ordem só funciona
// se `columns` abaixo estiver na MESMA ORDEM EXATA das colunas do arquivo
// real exportado do sistema de origem — incluindo colunas que a plataforma
// não usa (ex.: DATA_BASE no DARF) e sem contar campos sintéticos fora do
// lugar onde eles realmente aparecem (ex.: reference_month, criado por
// preprocessCompositeDateColumns, é ANEXADO NO FINAL do array de headers,
// não fica na posição de ANO/MES).
//
// Colunas marcadas `kind: "ignore"` existem só para ocupar a posição certa
// nesse alinhamento: nunca são exigidas, nunca aparecem na tela de mapeamento
// nem na revisão (ver ImportWizards.tsx), e seu valor nunca é incluído no
// payload enviado ao backend (ver buildPreview em parseUtils.ts).
// ─────────────────────────────────────────────────────────────────────────────

export type ColumnKind = "text" | "number" | "date" | "month_period" | "enum" | "ignore";

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
// Corresponde a job_darf_entries.
//
// A planilha exportada real traz 15 colunas — a plataforma usa 14. A 1ª
// coluna, DATA_BASE, não é usada por nenhum campo (job_darf_entries até tem
// uma coluna data_base, mas ela não é preenchida por este import) — por
// isso vira uma coluna "ignore", só para manter o alinhamento posicional.
// A partir daí, a ordem abaixo é a ordem REAL do arquivo: DARF (darf_code),
// DATA_ARRECADACAO, DATA_VENCIMENTO, PERIODO_APURACAO (assessment_period,
// que NÃO é a 1ª coluna de dado como se poderia supor), CODIGO_RECEITA...

export const DARF_CONFIG: ImportTableConfig = {
  id: "darf",
  title: "DARF",
  description: "Documentos de arrecadação (recolhimentos) por período de apuração.",
  defaultHeaderRow: 8,
  columns: [
    { key: "__ignore_data_base", label: "Coluna não utilizada (DATA_BASE)", kind: "ignore" },
    { key: "darf_code", label: "DARF", kind: "text",
      matchHints: ["darf"] },
    { key: "collection_date", label: "Data de arrecadação", kind: "date",
      matchHints: ["data_arrecadacao", "data de arrecadação", "data arrecadacao"] },
    { key: "due_date", label: "Data de vencimento", kind: "date",
      matchHints: ["data_vencimento", "data de vencimento"] },
    { key: "assessment_period", label: "Período de apuração", kind: "text", required: true,
      matchHints: ["periodo_apuracao", "periodo de apuracao", "período de apuração"] },
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
// cria uma coluna SINTÉTICA com esse nome literal NO FINAL do array de
// headers (depois de todas as colunas originais) — por isso reference_month
// vem por último aqui também, e ANO/MES viram colunas "ignore" na posição
// onde realmente estão no arquivo (1ª e 2ª).
//
// IMPORTANTE: os matchHints de "reference_month" continuam sem incluir
// "ano"/"mes"/"mês" — o mapeamento por NOME encontra o campo sintético pelo
// texto literal "reference_month" (é assim que a coluna sintética se chama),
// então não precisa e não deve tentar casar com os cabeçalhos originais.

export const M400_CONFIG: ImportTableConfig = {
  id: "sped-m400",
  title: "SPED — Registro M400",
  description: "Receitas isentas, não alcançadas ou com alíquota zero/suspensão (PIS/COFINS).",
  defaultHeaderRow: 8,
  columns: [
    { key: "__ignore_ano", label: "Coluna não utilizada (ANO)", kind: "ignore" },
    { key: "__ignore_mes", label: "Coluna não utilizada (MES)", kind: "ignore" },
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
    { key: "reference_month", label: "Mês de referência", kind: "month_period", required: true },
  ],
};

// ─── SPED M610 ────────────────────────────────────────────────────────────────
// Corresponde a job_sped_m610_entries. Mesma observação sobre ANO/MES/
// reference_month do M400 acima.

export const M610_CONFIG: ImportTableConfig = {
  id: "sped-m610",
  title: "SPED — Registro M610",
  description: "Detalhamento da contribuição para a Seguridade Social (COFINS) do período.",
  defaultHeaderRow: 8,
  columns: [
    { key: "__ignore_ano", label: "Coluna não utilizada (ANO)", kind: "ignore" },
    { key: "__ignore_mes", label: "Coluna não utilizada (MES)", kind: "ignore" },
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
    { key: "reference_month", label: "Mês de referência", kind: "month_period", required: true },
  ],
};

export const ALL_IMPORT_CONFIGS: ImportTableConfig[] = [
  PERDCOMP_CONFIG, DARF_CONFIG, M400_CONFIG, M610_CONFIG,
];