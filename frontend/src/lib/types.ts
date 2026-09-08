// Tipos espelhando exatamente o que a API retorna (ver schema.sql e os
// controllers do backend). Mantenha isso em sincronia se o backend mudar.

export type Role = "admin" | "user";

export type JobTitle =
  | "Analista Fiscal"
  | "Analista Tributário"
  | "Coordenador Tributário"
  | "Coordenadora Tributária"
  | "Gerente Tributário"
  | "Head Tributário";

export type TaxRegime =
  | "Lucro Real"
  | "Lucro Presumido"
  | "Simples Nacional"
  | "Lucro Arbitrado";

export type JobStatus =
  | "diagnostico"
  | "em_analise"
  | "revisao"
  | "parecer_emitido"
  | "concluido"
  | "cancelado";

export type CreditCategory = "ADM" | "FINTAX";
export type RiskColor = "VERDE" | "AMARELO" | "VERMELHO";
export type Contribution = "PIS" | "COFINS";

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  job_title: JobTitle | null;
  has_signature: boolean;
  signature_file_path: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
  initials?: string; // calculado no frontend, ver auth.tsx
}

export interface Client {
  id: number;
  cnpj: string;
  company_name: string;
  segment: string | null;
  tax_regime: TaxRegime | null;
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: number;
  role_in_job: string;
  user_id: number;
  name: string;
  email: string;
}

export interface Job {
  id: number;
  job_number: string;
  client_id: number;
  period_start: string;
  period_end: string;
  tax_regime: TaxRegime | null;
  segment: string | null;
  status: JobStatus;
  created_by: number | null;
  created_at: string;
  updated_at: string;
  // presentes na listagem (join com clients)
  company_name?: string;
  cnpj?: string;
}

export interface JobDetail extends Job {
  client_segment?: string | null;
  team: TeamMember[];
}

export interface Tax {
  id: number;
  code: string;
  name: string;
}

export interface CreditPoint {
  id: number;
  tax_id: number;
  name: string;
  category: CreditCategory;
  risk_color: RiskColor | null;
  legal_criteria: string | null;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  // presentes na listagem (join com taxes)
  tax_code?: string;
  tax_name?: string;
}

export interface JobDiagnostic {
  id: number;
  job_id: number;
  pays_darf: boolean | null;
  avg_monthly_pis_cofins: number | null;
  avg_yearly_pis_cofins: number | null;
  avg_monthly_irpj_csll: number | null;
  avg_yearly_irpj_csll: number | null;
  avg_monthly_inss: number | null;
  avg_yearly_inss: number | null;
  avg_monthly_ipi: number | null;
  avg_yearly_ipi: number | null;
  collection_method: string | null;
  opportunities_above_500k: boolean | null;
  already_credits_risk_point: boolean | null;
  has_debts_with_rfb: boolean | null;
  usage_plan: string | null;
  estimated_usage_months: number | null;
  observations: string | null;
}

export interface MonthlyValue {
  id: number;
  job_credit_point_analysis_id: number;
  contribution: Contribution | null;
  reference_month: string; // 'YYYY-MM-DD', sempre dia 01
  value: number;
}

export interface CreditPointAnalysis {
  id: number;
  job_id: number;
  credit_point_id: number;
  has_credit: boolean;
  observations: string | null;
  total_credit_value: number;
  analyzed_by: number | null;
  analyzed_at: string | null;
  // presentes na listagem (join com credit_points/taxes)
  credit_point_name?: string;
  category?: CreditCategory;
  risk_color?: RiskColor | null;
  tax_code?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export type PerdcompStatus = "EM_ANALISE" | "HOMOLOGADA" | "NAO_HOMOLOGADA" | "CANCELADA" | "RETIFICADA";

export interface Perdcomp {
  id: number;
  job_id: number;
  perdcomp_number: string;
  transmission_date: string | null;
  credit_type: string | null;
  document_type: string | null;
  status: PerdcompStatus;
}

export interface DarfEntry {
  id: number;
  job_id: number;
  data_base: string | null;
  darf_code: string | null;
  collection_date: string | null;
  due_date: string | null;
  assessment_period: string | null;
  revenue_code: string | null;
  name: string | null;
  document_number: string | null;
  total_value: number;
  days_late: number;
  principal_value: number;
  fine_value: number;
  interest_value: number;
  tax_group: string | null;
  cnpj: string | null;
}

export interface SpedM400Entry {
  id: number;
  job_id: number;
  reference_month: string;
  establishment: string | null;
  reg: string | null;
  cst: string | null;
  gross_revenue_value: number;
  accounting_account_code: string | null;
  revenue_description: string | null;
  bookkeeping_type: string | null;
}

export interface SpedM610Entry {
  id: number;
  job_id: number;
  reference_month: string;
  establishment: string | null;
  contribution_code: string | null;
  contribution_description: string | null;
  gross_revenue_value: number;
  calculation_base_value: number;
  pis_aliquot: number;
  pis_quantity: number;
  pis_quantity_aliquot: number;
  total_contribution_calculated: number;
  addition_adjustments_value: number;
  reduction_adjustments_value: number;
  deferred_contribution_value: number;
  previous_deferred_contribution_value: number;
  total_period_contribution_value: number;
  bookkeeping_type: string | null;
}