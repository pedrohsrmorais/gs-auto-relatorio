export type ImportColumnType = "string" | "number" | "date" | "enum";

export interface ImportColumnDef {
  key: string;
  label: string;
  type: ImportColumnType;
  required?: boolean;
  enumValues?: string[];
  aliases: string[];
}

export interface ImportTableConfig {
  id: "perdcomp" | "darf" | "m400" | "m610";
  title: string;
  description: string;
  columns: ImportColumnDef[];
}

export type ImportRowStatus = "ok" | "warning" | "error";

export interface ImportValidationRow {
  rowIndex: number;
  status: ImportRowStatus;
  messages: string[];
  data: Record<string, unknown>;
}

export interface ImportPreviewResult {
  columns: string[];
  totalRows: number;
  validRows: number;
  errorRows: number;
  rows: ImportValidationRow[];
}

export const PERDCOMP_CONFIG: ImportTableConfig = {
  id: "perdcomp",
  title: "PER/DCOMP",
  description: "Pedidos de restituição/compensação transmitidos pelo cliente.",
  columns: [
    { key: "perdcomp_number", label: "Número do PER/DCOMP", type: "string", required: true, aliases: ["numero do per/dcomp", "numero perdcomp", "perdcomp", "numero"] },
    { key: "transmission_date", label: "Data de Transmissão", type: "date", aliases: ["data de transmissao", "data transmissao", "dt transmissao"] },
    { key: "credit_type", label: "Tipo de Crédito", type: "string", aliases: ["tipo de credito", "tipo credito"] },
    { key: "document_type", label: "Tipo de Documento", type: "string", aliases: ["tipo de documento", "tipo documento"] },
    {
      key: "status", label: "Situação", type: "enum", required: true,
      enumValues: ["EM_ANALISE", "HOMOLOGADA", "NAO_HOMOLOGADA", "CANCELADA", "RETIFICADA"],
      aliases: ["situacao", "status"],
    },
  ],
};

export const DARF_CONFIG: ImportTableConfig = {
  id: "darf",
  title: "DARF",
  description: "Documentos de arrecadação (recolhimentos) por período de apuração.",
  columns: [
    { key: "data_base", label: "Data Base", type: "date", aliases: ["data_base", "data base"] },
    { key: "darf_code", label: "DARF", type: "string", aliases: ["darf"] },
    { key: "collection_date", label: "Data de Arrecadação", type: "date", aliases: ["data_arrecadacao", "data de arrecadacao"] },
    { key: "due_date", label: "Data de Vencimento", type: "date", aliases: ["data_vencimento", "data de vencimento"] },
    { key: "assessment_period", label: "Período de Apuração", type: "string", aliases: ["periodo_apuracao", "periodo de apuracao"] },
    { key: "revenue_code", label: "Código da Receita", type: "string", aliases: ["codigo_receita", "codigo da receita"] },
    { key: "name", label: "Nome", type: "string", aliases: ["nome"] },
    { key: "document_number", label: "Número do Documento", type: "string", aliases: ["numero_documento", "numero do documento"] },
    { key: "total_value", label: "Valor Total", type: "number", required: true, aliases: ["valor_total", "valor total"] },
    { key: "days_late", label: "Dias de Atraso", type: "number", aliases: ["dias_atraso", "dias de atraso"] },
    { key: "principal_value", label: "Valor Principal", type: "number", aliases: ["valor_principal", "valor principal"] },
    { key: "fine_value", label: "Multa", type: "number", aliases: ["multa"] },
    { key: "interest_value", label: "Juros", type: "number", aliases: ["juros"] },
    { key: "tax_group", label: "Grupo do Tributo", type: "string", aliases: ["grupo_tributo", "grupo do tributo"] },
    { key: "cnpj", label: "CNPJ", type: "string", required: true, aliases: ["cnpj"] },
  ],
};

// M400/M610 vêm com ANO e MÊS em colunas separadas na planilha original.
// O parser (preprocessCompositeDateColumns) funde as duas antes do mapeamento,
// então aqui só precisamos de um campo de data "reference_month".
export const M400_CONFIG: ImportTableConfig = {
  id: "m400",
  title: "SPED — Registro M400",
  description: "Receitas isentas, não tributadas ou sujeitas à alíquota zero (PIS/COFINS).",
  columns: [
    { key: "reference_month", label: "Competência (Ano/Mês)", type: "date", required: true, aliases: ["competencia (ano/mes)", "competencia", "ano/mes", "data_base", "data base"] },
    { key: "establishment", label: "Estabelecimento", type: "string", aliases: ["estabelecimento"] },
    { key: "reg", label: "REG", type: "string", aliases: ["reg"] },
    { key: "cst", label: "Código de Situação Tributária", type: "string", aliases: ["codigo de situacao tributaria", "cst"] },
    { key: "gross_revenue_value", label: "Valor Total da Receita Bruta no Período", type: "number", required: true, aliases: ["valor total da receita bruta no periodo", "valor total da receita bruta"] },
    { key: "accounting_account_code", label: "Código da Conta Analítica Contábil Debitada/Creditada", type: "string", aliases: ["codigo da conta analitica contabil debitada/creditada", "codigo da conta"] },
    { key: "revenue_description", label: "Descrição Complementar da Natureza da Receita", type: "string", aliases: ["descricao complementar da natureza da receita", "descricao"] },
    { key: "bookkeeping_type", label: "Tipo de Escrituração", type: "string", aliases: ["tipo_escrit", "tipo de escrituracao"] },
  ],
};

export const M610_CONFIG: ImportTableConfig = {
  id: "m610",
  title: "SPED — Registro M610",
  description: "Apuração da contribuição para o PIS/PASEP e COFINS do período.",
  columns: [
    { key: "reference_month", label: "Competência (Ano/Mês)", type: "date", required: true, aliases: ["competencia (ano/mes)", "competencia", "ano/mes", "data_base", "data base"] },
    { key: "establishment", label: "Estabelecimento", type: "string", aliases: ["estabelecimento"] },
    { key: "contribution_code", label: "Código Contribuição Social", type: "string", aliases: ["codigo contribuicao social", "cod_cont", "codigo contribuicao social [cod_cont]"] },
    { key: "contribution_description", label: "Descrição da Contribuição Social", type: "string", aliases: ["descricao da contribuicao social", "descricao da contibuicao social"] },
    { key: "gross_revenue_value", label: "Valor da Receita Bruta", type: "number", required: true, aliases: ["valor da receita bruta", "vl_rec_brt", "valor da receita bruta [vl_rec_brt]"] },
    { key: "calculation_base_value", label: "Valor da Base de Cálculo", type: "number", aliases: ["valor da base de calculo", "vl_bc_cont", "valor da base de calculo [vl_bc_cont]"] },
    { key: "pis_aliquot", label: "Alíquota do PIS/PASEP", type: "number", aliases: ["aliquota do pis/pasep", "aliq_pisa", "aliquota do pis/pasep [aliq_pisa]"] },
    { key: "pis_quantity", label: "Quantidade PIS", type: "number", aliases: ["quantidade pis", "quant_bc_pis", "quantidade pis [quant_bc_pis]"] },
    { key: "pis_quantity_aliquot", label: "Alíquota PIS (Quantidade)", type: "number", aliases: ["aliquota pis", "aliq_pis_quant", "aliquota pis [aliq_pis_quant]"] },
    { key: "total_contribution_calculated", label: "Valor Total da Contribuição Apurada", type: "number", aliases: ["valor total da contribuicao social apurada", "vl_cont_apur", "valor total da contribuicao social apurada [vl_cont_apur]"] },
    { key: "addition_adjustments_value", label: "Valor Total dos Ajustes de Acréscimo", type: "number", aliases: ["valor total dos ajustes de acrescimo", "vl_ajus_acres", "valor total dos ajustes de acrescimo [vl_ajus_acres]"] },
    { key: "reduction_adjustments_value", label: "Valor Total dos Ajustes de Redução", type: "number", aliases: ["valor total dos ajustes de reducao", "vl_ajus_reduc", "valor total dos ajustes de reducao [vl_ajus_reduc]"] },
    { key: "deferred_contribution_value", label: "Valor da Contribuição a Diferir no Período", type: "number", aliases: ["valor da contribuicao a diferir no periodo", "vl_cont_difer", "valor da contribuicao a diferir no periodo [vl_cont_difer]"] },
    { key: "previous_deferred_contribution_value", label: "Valor da Contribuição Diferida em Períodos Anteriores", type: "number", aliases: ["valor da contribuicao diferida em periodos anteriores", "vl_cont_difer_ant"] },
    { key: "total_period_contribution_value", label: "Valor Total da Contribuição do Período", type: "number", aliases: ["valor total da contribuicao do periodo", "vl_cont_per", "valor total da contribuicao do periodo (08+09-10-11+12) [vl_cont_per]"] },
    { key: "bookkeeping_type", label: "Tipo de Escrituração", type: "string", aliases: ["tipo_escrit"] },
  ],
};

export const IMPORT_CONFIGS = [PERDCOMP_CONFIG, DARF_CONFIG, M400_CONFIG, M610_CONFIG];