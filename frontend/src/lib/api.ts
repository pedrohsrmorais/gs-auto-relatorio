import axios, { AxiosError } from "axios";
import type {
  User, Client, Job, JobDetail, JobDiagnostic, PaginatedResponse, Role, TaxRegime, JobStatus,
} from "@/lib/types";
import type { ParsedPontoMonthlyRow, ParsedIpiMonthlyRow } from "@/lib/import/customParsers";

// ─── Erro tipado ──────────────────────────────────────────────────────────────

export class ApiError extends Error {
  status: number;
  details?: unknown;
  constructor(status: number, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.details = details;
  }
}

// ─── Armazenamento de tokens ──────────────────────────────────────────────────

const REFRESH_TOKEN_KEY = "studio-fiscal:refreshToken";
let accessToken: string | null = null;

export const tokenStorage = {
  getAccessToken: () => accessToken,
  setAccessToken: (token: string | null) => { accessToken = token; },
  getRefreshToken: () => localStorage.getItem(REFRESH_TOKEN_KEY),
  setRefreshToken: (token: string | null) => {
    if (token) localStorage.setItem(REFRESH_TOKEN_KEY, token);
    else localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
  clear: () => {
    accessToken = null;
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  },
};

// ─── Instância axios ──────────────────────────────────────────────────────────

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? "/api",
  headers: { "Content-Type": "application/json" },
});

http.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

const AUTH_ROUTES = ["/auth/login", "/auth/refresh"];
let refreshPromise: Promise<string | null> | null = null;

async function refreshAccessToken(): Promise<string | null> {
  const refreshToken = tokenStorage.getRefreshToken();
  if (!refreshToken) return null;

  if (!refreshPromise) {
    refreshPromise = http
      .post("/auth/refresh", { refreshToken })
      .then((res) => {
        const { accessToken: newAccess, refreshToken: newRefresh } = res.data.data;
        tokenStorage.setAccessToken(newAccess);
        tokenStorage.setRefreshToken(newRefresh);
        return newAccess as string;
      })
      .catch(() => {
        tokenStorage.clear();
        return null;
      })
      .finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError<{ message?: string; details?: unknown }>) => {
    const originalRequest = error.config as (typeof error.config & { _retry?: boolean }) | undefined;
    const status = error.response?.status;
    const url = originalRequest?.url ?? "";
    const isAuthRoute = AUTH_ROUTES.some((r) => url.includes(r));

    if (status === 401 && !isAuthRoute && originalRequest && !originalRequest._retry) {
      originalRequest._retry = true;
      const newAccessToken = await refreshAccessToken();
      if (newAccessToken) {
        originalRequest.headers = originalRequest.headers ?? {};
        originalRequest.headers.Authorization = `Bearer ${newAccessToken}`;
        return http(originalRequest);
      }
    }

    const message = error.response?.data?.message ?? error.message ?? "Erro inesperado.";
    throw new ApiError(status ?? 0, message, error.response?.data?.details);
  }
);

function qs(params: Record<string, unknown>): string {
  const clean = Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== "");
  return new URLSearchParams(clean as [string, string][]).toString();
}

// ─── auth ─────────────────────────────────────────────────────────────────────

export const authApi = {
  async login(data: { email: string; password: string }) {
    const res = await http.post<{ data: { user: User; accessToken: string; refreshToken: string } }>(
      "/auth/login", data
    );
    const { user, accessToken: at, refreshToken: rt } = res.data.data;
    tokenStorage.setAccessToken(at);
    tokenStorage.setRefreshToken(rt);
    return user;
  },
  async logout() {
    const refreshToken = tokenStorage.getRefreshToken();
    try {
      if (refreshToken) await http.post("/auth/logout", { refreshToken });
    } finally {
      tokenStorage.clear();
    }
  },
  async me() {
    const res = await http.get<{ data: User }>("/auth/me");
    return res.data.data;
  },
  async changePassword(currentPassword: string, newPassword: string) {
    await http.patch("/auth/me/password", { currentPassword, newPassword });
  },
};

// ─── users (admin) ────────────────────────────────────────────────────────────

export const usersApi = {
  async list(params: { search?: string; role?: Role; is_active?: boolean; page?: number; limit?: number } = {}) {
    const res = await http.get<PaginatedResponse<User>>(`/users?${qs(params)}`);
    return res.data;
  },
  async create(data: { name: string; email: string; password: string; role: Role; job_title?: string }) {
    const res = await http.post<{ data: User }>("/users", data);
    return res.data.data;
  },
  async update(id: number, data: Partial<Pick<User, "name" | "job_title" | "has_signature" | "is_active">>) {
    const res = await http.put<{ data: User }>(`/users/${id}`, data);
    return res.data.data;
  },
  async updateRole(id: number, role: Role) {
    const res = await http.patch<{ data: User }>(`/users/${id}/role`, { role });
    return res.data.data;
  },
  async deactivate(id: number) {
    await http.delete(`/users/${id}`);
  },
};

// ─── credit point definitions (catálogo global de pontos ADM/FTX) ────────────

export type TaxCode = "PIS_COFINS" | "IRPJ_CSLL" | "INSS" | "IPI" | "ICMS";
export type PointNature = "CREDITO" | "PASSIVO";

export interface PointDefinition {
  id: number;
  category: "ADM" | "FTX";
  tax_id: number | null;
  tax_code: TaxCode | null;
  tax_name: string | null;
  nature: PointNature;
  external_id: string;
  name: string;
  risk_color: "VERDE" | "AMARELO" | "VERMELHO" | null;
  updated_at: string;
}

export interface DefinitionImportRow {
  external_id: string;
  name: string;
  risk_color?: "VERDE" | "AMARELO" | "VERMELHO" | null;
  /**
   * Tributo/natureza DESTA linha específica — as planilhas mestre (PRT para
   * ADM, Fintax para FTX) trazem uma coluna NOME TRIBUTO por linha, então
   * cada ponto pode ter um tributo diferente dentro do MESMO arquivo.
   * Quando ausente, o backend usa o `defaultTaxCode`/`nature` passados para
   * bulkImport como fallback (útil só para planilhas sem essa coluna).
   */
  tax_code?: TaxCode;
  nature?: PointNature;
}

export interface DefinitionBulkImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  unknownTaxCodes: string[];
}

export const creditPointDefinitionsApi = {
  async list(params: { category?: "ADM" | "FTX"; tax?: TaxCode; nature?: PointNature; search?: string } = {}): Promise<PointDefinition[]> {
    const res = await http.get<{ data: PointDefinition[] }>(`/credit-point-definitions?${qs(params)}`);
    return res.data.data;
  },
  async updateName(id: number, name: string): Promise<PointDefinition> {
    const res = await http.patch<{ data: PointDefinition }>(`/credit-point-definitions/${id}`, { name });
    return res.data.data;
  },
  async updateRiskColor(id: number, riskColor: "VERDE" | "AMARELO" | "VERMELHO" | null): Promise<PointDefinition> {
    const res = await http.patch<{ data: PointDefinition }>(`/credit-point-definitions/${id}`, { risk_color: riskColor });
    return res.data.data;
  },
  async updateTax(id: number, taxCode: TaxCode): Promise<PointDefinition> {
    const res = await http.patch<{ data: PointDefinition }>(`/credit-point-definitions/${id}`, { tax_code: taxCode });
    return res.data.data;
  },
  /**
   * `defaultTaxCode`/`defaultNature` são só FALLBACK — se as `rows` já
   * trouxerem `tax_code`/`nature` próprios (planilhas PRT/Fintax, que têm
   * coluna NOME TRIBUTO), o valor de cada linha prevalece.
   */
  async bulkImport(
    category: "ADM" | "FTX",
    rows: DefinitionImportRow[],
    defaultTaxCode?: TaxCode,
    defaultNature: PointNature = "CREDITO"
  ): Promise<DefinitionBulkImportResult> {
    const res = await http.post<{ data: DefinitionBulkImportResult }>(
      "/credit-point-definitions/bulk-import",
      { category, tax_code: defaultTaxCode, nature: defaultNature, rows }
    );
    return res.data.data;
  },
  /** Bloqueado pelo backend (409) se o ponto já tiver valores importados em algum job. */
  async remove(id: number) {
    await http.delete(`/credit-point-definitions/${id}`);
  },
  /**
   * Cria UM ponto manualmente — usado pelos wizards de IPI/IR-CSLL quando o
   * usuário confirma explicitamente que o ponto não existe no catálogo.
   * Nunca é chamado automaticamente/silenciosamente.
   */
  async quickCreate(category: "ADM" | "FTX", taxCode: TaxCode, name: string, nature: PointNature = "CREDITO") {
    const res = await http.post<{ data: { id: number; name: string; external_id: string } }>(
      "/credit-point-definitions/quick-create",
      { category, tax_code: taxCode, name, nature }
    );
    return res.data.data;
  },
  /**
   * Apaga TODOS os pontos do catálogo global E todos os valores já
   * importados em QUALQUER job (pontos_adm/ftx/ipi/ir_csll, observações).
   * Destrutivo e irreversível — sempre confirme explicitamente com o
   * usuário antes de chamar isso.
   */
  async resetAll(): Promise<{ deleted: Record<string, number> }> {
    const res = await http.delete<{ data: { deleted: Record<string, number> } }>("/credit-point-definitions");
    return res.data.data;
  },
};

// ─── clients ──────────────────────────────────────────────────────────────────

export const clientsApi = {
  async list(params: { search?: string; page?: number; limit?: number } = {}) {
    const res = await http.get<PaginatedResponse<Client>>(`/clients?${qs(params)}`);
    return res.data;
  },
  async create(data: { cnpj: string; company_name: string; segment?: string; tax_regime?: TaxRegime }) {
    const res = await http.post<{ data: Client }>("/clients", data);
    return res.data.data;
  },
  async remove(id: number) {
    await http.delete(`/clients/${id}`);
  },
};

// ─── jobs ─────────────────────────────────────────────────────────────────────

export const jobsApi = {
  async list(params: { search?: string; status?: JobStatus; client_id?: number; page?: number; limit?: number } = {}) {
    const res = await http.get<PaginatedResponse<Job>>(`/jobs?${qs(params)}`);
    return res.data;
  },
  async get(id: number) {
    const res = await http.get<{ data: JobDetail }>(`/jobs/${id}`);
    return res.data.data;
  },
  async create(data: { job_number: string; client_id: number; period_start: string; period_end: string; tax_regime?: TaxRegime; segment?: string }) {
    const res = await http.post<{ data: Job }>("/jobs", data);
    return res.data.data;
  },
  async updateStatus(id: number, status: JobStatus) {
    const res = await http.patch<{ data: Job }>(`/jobs/${id}/status`, { status });
    return res.data.data;
  },
  async updateDetails(id: number, data: { tax_regime?: TaxRegime; segment?: string }) {
    const res = await http.patch<{ data: Job }>(`/jobs/${id}/details`, data);
    return res.data.data;
  },
  async remove(id: number) {
    await http.delete(`/jobs/${id}`);
  },
};

// ─── diagnóstico do job (1:1 — campos gerais, ex: parecer geral do job) ──────

export const jobDiagnosticApi = {
  async get(jobId: number): Promise<JobDiagnostic | null> {
    try {
      const res = await http.get<{ data: JobDiagnostic }>(`/jobs/${jobId}/diagnostic`);
      return res.data.data;
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) return null;
      throw err;
    }
  },
  async upsert(jobId: number, data: Partial<Omit<JobDiagnostic, "id" | "job_id">>) {
    const res = await http.put<{ data: JobDiagnostic }>(`/jobs/${jobId}/diagnostic`, data);
    return res.data.data;
  },
};

// ─── diagnóstico por ponto (ADM/FTX x PIS_COFINS/IPI/IRPJ_CSLL) ──────────────

export type DiagnosticCategory = "ADM" | "FTX";
export type DiagnosticTax = "PIS_COFINS" | "IPI" | "IRPJ_CSLL" | "INSS";

export interface DiagnosticBreakdownItem {
  label: string;
  value: number;
}

export interface DiagnosticPointSummary {
  credit_point_definition_id: number;
  external_id: string;
  name: string;
  risk_color: "VERDE" | "AMARELO" | "VERMELHO" | null;
  total: number;
  breakdown: DiagnosticBreakdownItem[];
  observations: string | null;
  // Campos legados (só vêm preenchidos quando tax=PIS_COFINS, mantidos
  // para não quebrar código existente que ainda lê pis_total/cofins_total).
  pis_total?: number;
  cofins_total?: number;
  irpj_total?: number;
  csll_total?: number;
}

export interface DiagnosticMonthlyRow {
  period_label: string;
  total: number;
  pis_value?: number;
  cofins_value?: number;
  irpj_value?: number;
  csll_value?: number;
}

export const diagnosticsApi = {
  async listPoints(jobId: number, category: DiagnosticCategory, tax: DiagnosticTax = "PIS_COFINS"): Promise<DiagnosticPointSummary[]> {
    const res = await http.get<{ data: DiagnosticPointSummary[] }>(
      `/jobs/${jobId}/diagnostics/points?${qs({ category, tax })}`
    );
    return res.data.data;
  },
  async getMonthly(
    jobId: number, creditPointDefinitionId: number, category: DiagnosticCategory, tax: DiagnosticTax = "PIS_COFINS"
  ): Promise<DiagnosticMonthlyRow[]> {
    const res = await http.get<{ data: DiagnosticMonthlyRow[] }>(
      `/jobs/${jobId}/diagnostics/points/${creditPointDefinitionId}/monthly?${qs({ category, tax })}`
    );
    return res.data.data;
  },
  async updateNote(jobId: number, creditPointDefinitionId: number, data: { observations?: string | null }) {
    const res = await http.put<{ data: unknown }>(
      `/jobs/${jobId}/diagnostics/points/${creditPointDefinitionId}`, data
    );
    return res.data.data;
  },
};

// ─── tipos de dados das fontes brutas ────────────────────────────────────────

import type { Perdcomp, DarfEntry, SpedM400Entry, SpedM610Entry } from "@/lib/types";

// ─── PER/DCOMP ────────────────────────────────────────────────────────────────

export const perdcompApi = {
  async list(jobId: number): Promise<Perdcomp[]> {
    const res = await http.get<{ data: Perdcomp[] }>(`/jobs/${jobId}/perdcomps`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: Record<string, unknown>[]) {
    const res = await http.post<{ data: { inserted: number } }>(`/jobs/${jobId}/perdcomps/bulk-import`, { rows });
    return res.data.data;
  },
  async remove(jobId: number, id: number) {
    await http.delete(`/jobs/${jobId}/perdcomps/${id}`);
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/perdcomps`);
    return res.data.data;
  },
};

// ─── DARF ─────────────────────────────────────────────────────────────────────

export const darfApi = {
  async list(jobId: number): Promise<DarfEntry[]> {
    const res = await http.get<{ data: DarfEntry[] }>(`/jobs/${jobId}/darf-entries`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: Record<string, unknown>[]) {
    const res = await http.post<{ data: { inserted: number } }>(`/jobs/${jobId}/darf-entries/bulk-import`, { rows });
    return res.data.data;
  },
  async remove(jobId: number, id: number) {
    await http.delete(`/jobs/${jobId}/darf-entries/${id}`);
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/darf-entries`);
    return res.data.data;
  },
};

// ─── SPED M400 ────────────────────────────────────────────────────────────────

export const spedM400Api = {
  async list(jobId: number): Promise<SpedM400Entry[]> {
    const res = await http.get<{ data: SpedM400Entry[] }>(`/jobs/${jobId}/sped/m400`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: Record<string, unknown>[]) {
    const res = await http.post<{ data: { inserted: number } }>(`/jobs/${jobId}/sped/m400/bulk-import`, { rows });
    return res.data.data;
  },
  async remove(jobId: number, id: number) {
    await http.delete(`/jobs/${jobId}/sped/m400/${id}`);
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/sped/m400`);
    return res.data.data;
  },
};

// ─── SPED M610 ────────────────────────────────────────────────────────────────

export const spedM610Api = {
  async list(jobId: number): Promise<SpedM610Entry[]> {
    const res = await http.get<{ data: SpedM610Entry[] }>(`/jobs/${jobId}/sped/m610`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: Record<string, unknown>[]) {
    const res = await http.post<{ data: { inserted: number } }>(`/jobs/${jobId}/sped/m610/bulk-import`, { rows });
    return res.data.data;
  },
  async remove(jobId: number, id: number) {
    await http.delete(`/jobs/${jobId}/sped/m610/${id}`);
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/sped/m610`);
    return res.data.data;
  },
};

// ─── Pontos ADM (valores mensais por job, PIS/COFINS) ────────────────────────

export interface PontoImportGroup {
  external_point_id: string;
  rows: ParsedPontoMonthlyRow[];
  point_name?: string;
}

export interface PontoImportResult {
  inserted: number;
  pointName: string;
  points: { external_point_id: string; point_name: string; inserted: number }[];
}

export const pontosAdmApi = {
  async list(jobId: number) {
    const res = await http.get<{ data: Record<string, unknown>[] }>(`/jobs/${jobId}/pontos-adm`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: ParsedPontoMonthlyRow[]) {
    const res = await http.post<{ data: PontoImportResult }>(
      `/jobs/${jobId}/pontos-adm/bulk-import`, { rows }
    );
    return res.data.data;
  },
  async bulkImportGroups(jobId: number, groups: PontoImportGroup[]) {
    const res = await http.post<{ data: PontoImportResult }>(
      `/jobs/${jobId}/pontos-adm/bulk-import`, { groups }
    );
    return res.data.data;
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/pontos-adm`);
    return res.data.data;
  },
};

// ─── Pontos FTX (valores mensais por job, PIS/COFINS) ────────────────────────

export const pontosFtxApi = {
  async list(jobId: number) {
    const res = await http.get<{ data: Record<string, unknown>[] }>(`/jobs/${jobId}/pontos-ftx`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: ParsedPontoMonthlyRow[]) {
    const res = await http.post<{ data: PontoImportResult }>(
      `/jobs/${jobId}/pontos-ftx/bulk-import`, { rows }
    );
    return res.data.data;
  },
  async bulkImportGroups(jobId: number, groups: PontoImportGroup[]) {
    const res = await http.post<{ data: PontoImportResult }>(
      `/jobs/${jobId}/pontos-ftx/bulk-import`, { groups }
    );
    return res.data.data;
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/pontos-ftx`);
    return res.data.data;
  },
};

// ─── Pontos ADM IPI (valores mensais por job, 1 arquivo = 1 ponto, sem split) ─
// O ponto (credit_point_definition_id) já vem RESOLVIDO pelo wizard — o
// usuário confirmou o match ou escolheu manualmente. Ver IpiIrCsllWizards.tsx.

export interface IpiImportResult {
  inserted: number;
  pointName: string;
}

export const pontosIpiApi = {
  async list(jobId: number) {
    const res = await http.get<{ data: Record<string, unknown>[] }>(`/jobs/${jobId}/pontos-ipi`);
    return res.data.data;
  },
  async bulkImport(jobId: number, creditPointDefinitionId: number, rows: ParsedIpiMonthlyRow[]) {
    const res = await http.post<{ data: IpiImportResult }>(
      `/jobs/${jobId}/pontos-ipi/bulk-import`,
      { credit_point_definition_id: creditPointDefinitionId, rows }
    );
    return res.data.data;
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/pontos-ipi`);
    return res.data.data;
  },
};

// ─── Pontos ADM IR/CSLL (valores anuais por job, 1 arquivo = N pontos) ───────
// Cada linha já vem com o ponto RESOLVIDO (credit_point_definition_id) —
// ver IpiIrCsllWizards.tsx.

export interface IrCsllValueRow {
  credit_point_definition_id: number;
  reference_year: number;
  tax_sub_type: "IRPJ" | "CSLL";
  value: number;
}

export interface IrCsllImportResult {
  inserted: number;
}

export const pontosIrCsllApi = {
  async list(jobId: number) {
    const res = await http.get<{ data: Record<string, unknown>[] }>(`/jobs/${jobId}/pontos-ir-csll`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: IrCsllValueRow[]) {
    const res = await http.post<{ data: IrCsllImportResult }>(
      `/jobs/${jobId}/pontos-ir-csll/bulk-import`, { rows }
    );
    return res.data.data;
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/pontos-ir-csll`);
    return res.data.data;
  },
};

// ─── Pontos INSS (valores anuais por job, 1 arquivo = N pontos, sem split) ───
// Cada linha já vem com o ponto RESOLVIDO (credit_point_definition_id) —
// ver InssImportWizard em IpiIrCsllWizards.tsx.

export interface InssValueRow {
  credit_point_definition_id: number;
  reference_year: number;
  value: number;
}

export interface InssImportResult {
  inserted: number;
}

export const pontosInssApi = {
  async list(jobId: number) {
    const res = await http.get<{ data: Record<string, unknown>[] }>(`/jobs/${jobId}/pontos-inss`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: InssValueRow[]) {
    const res = await http.post<{ data: InssImportResult }>(
      `/jobs/${jobId}/pontos-inss/bulk-import`, { rows }
    );
    return res.data.data;
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/pontos-inss`);
    return res.data.data;
  },
};