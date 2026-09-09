import axios, { AxiosError } from "axios";
import type {
  User, Client, Job, JobDetail, Tax, CreditPoint, JobDiagnostic,
  CreditPointAnalysis, MonthlyValue, PaginatedResponse, Role, CreditCategory,
  RiskColor, TaxRegime, JobStatus, Contribution,
} from "@/lib/types";
import type { ParsedPontoMonthlyRow } from "@/lib/import/pontoMatrixParser";
import type { ParsedCategoriaRow } from "@/lib/import/categoriaParser";

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
// accessToken fica só em memória (mais seguro contra XSS).
// refreshToken vai pro localStorage para sobreviver a um F5.

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

// ─── taxes ────────────────────────────────────────────────────────────────────

export const taxesApi = {
  async list() {
    const res = await http.get<{ data: Tax[] }>("/taxes");
    return res.data.data;
  },
};

// ─── credit points (catálogo) ─────────────────────────────────────────────────

export const creditPointsApi = {
  async list(params: {
    tax_id?: number; category?: CreditCategory; risk_color?: RiskColor;
    is_active?: boolean; search?: string; page?: number; limit?: number;
  } = {}) {
    const res = await http.get<PaginatedResponse<CreditPoint>>(`/credit-points?${qs(params)}`);
    return res.data;
  },
  async create(data: { tax_id: number; name: string; category: CreditCategory; risk_color?: RiskColor; legal_criteria?: string }) {
    const res = await http.post<{ data: CreditPoint }>("/credit-points", data);
    return res.data.data;
  },
  async update(id: number, data: Partial<Pick<CreditPoint, "name" | "category" | "risk_color" | "legal_criteria" | "is_active">>) {
    const res = await http.put<{ data: CreditPoint }>(`/credit-points/${id}`, data);
    return res.data.data;
  },
  async deactivate(id: number) {
    await http.delete(`/credit-points/${id}`);
  },
};

// ─── credit point definitions (nomeação de pontos importados via planilha) ────

export interface PointDefinition {
  id: number;
  category: "ADM" | "FTX";
  external_id: string;
  name: string;
  updated_at: string;
}

export const creditPointDefinitionsApi = {
  async list(params: { category?: "ADM" | "FTX"; search?: string } = {}): Promise<PointDefinition[]> {
    const res = await http.get<{ data: PointDefinition[] }>(`/credit-point-definitions?${qs(params)}`);
    return res.data.data;
  },
  async updateName(id: number, name: string): Promise<PointDefinition> {
    const res = await http.patch<{ data: PointDefinition }>(`/credit-point-definitions/${id}`, { name });
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
};

// ─── diagnóstico (1:1 por job) ────────────────────────────────────────────────

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

// ─── análise de pontos de crédito + valores mensais ──────────────────────────

export const jobCreditAnalysisApi = {
  async list(jobId: number, params: { category?: CreditCategory; risk_color?: RiskColor; has_credit?: boolean } = {}) {
    const res = await http.get<{ data: CreditPointAnalysis[] }>(`/jobs/${jobId}/credit-analyses?${qs(params)}`);
    return res.data.data;
  },
  async get(jobId: number, analysisId: number) {
    const res = await http.get<{ data: CreditPointAnalysis & { monthlyValues: MonthlyValue[] } }>(
      `/jobs/${jobId}/credit-analyses/${analysisId}`
    );
    return res.data.data;
  },
  async upsertByCreditPoint(jobId: number, creditPointId: number, data: { has_credit: boolean; observations?: string }) {
    const res = await http.put<{ data: CreditPointAnalysis }>(
      `/jobs/${jobId}/credit-analyses/${creditPointId}`, data
    );
    return res.data.data;
  },
  async setMonthlyValue(jobId: number, analysisId: number, month: string, data: { contribution?: Contribution; value: number }) {
    const res = await http.put<{ data: { total_credit_value: number } }>(
      `/jobs/${jobId}/credit-analyses/${analysisId}/months/${month}`, data
    );
    return res.data.data;
  },
  async bulkSetMonthlyValues(
    jobId: number, analysisId: number,
    entries: Array<{ contribution?: Contribution; reference_month: string; value: number }>
  ) {
    const res = await http.post<{ data: { total_credit_value: number; monthlyValues: MonthlyValue[] } }>(
      `/jobs/${jobId}/credit-analyses/${analysisId}/months/bulk`, { entries }
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

// ─── Pontos ADM ───────────────────────────────────────────────────────────────

export const pontosAdmApi = {
  async list(jobId: number) {
    const res = await http.get<{ data: Record<string, unknown>[] }>(`/jobs/${jobId}/pontos-adm`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: ParsedPontoMonthlyRow[]) {
    const res = await http.post<{ data: { inserted: number; pointName: string } }>(
      `/jobs/${jobId}/pontos-adm/bulk-import`, { rows }
    );
    return res.data.data;
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/pontos-adm`);
    return res.data.data;
  },
};

// ─── Pontos FTX ───────────────────────────────────────────────────────────────

export const pontosFtxApi = {
  async list(jobId: number) {
    const res = await http.get<{ data: Record<string, unknown>[] }>(`/jobs/${jobId}/pontos-ftx`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: ParsedPontoMonthlyRow[]) {
    const res = await http.post<{ data: { inserted: number; pointName: string } }>(
      `/jobs/${jobId}/pontos-ftx/bulk-import`, { rows }
    );
    return res.data.data;
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/pontos-ftx`);
    return res.data.data;
  },
};

// ─── Comparativo por categoria (Relatório 2) ──────────────────────────────────

export const ftxCategoriaApi = {
  async list(jobId: number) {
    const res = await http.get<{ data: Record<string, unknown>[] }>(`/jobs/${jobId}/ftx-categoria`);
    return res.data.data;
  },
  async bulkImport(jobId: number, rows: ParsedCategoriaRow[]) {
    const res = await http.post<{ data: { inserted: number } }>(`/jobs/${jobId}/ftx-categoria/bulk-import`, { rows });
    return res.data.data;
  },
  async clearAll(jobId: number) {
    const res = await http.delete<{ data: { deleted: number } }>(`/jobs/${jobId}/ftx-categoria`);
    return res.data.data;
  },
};