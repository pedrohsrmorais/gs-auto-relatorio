import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { jobsApi } from "@/lib/api";
import type { JobStatus } from "@/lib/types";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { NewJobDialog } from "@/components/NewJobDialog";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Card } from "@/components/ui/card";

export const Route = createFileRoute("/jobs/")({
  component: () => (
    <ProtectedRoute>
      <JobsListPage />
    </ProtectedRoute>
  ),
});

const STATUS_LABEL: Record<JobStatus, string> = {
  diagnostico: "Diagnóstico",
  em_analise: "Em análise",
  revisao: "Revisão",
  parecer_emitido: "Parecer emitido",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

const STATUS_VARIANT: Record<JobStatus, "muted" | "default" | "warning" | "success" | "destructive"> = {
  diagnostico: "muted",
  em_analise: "default",
  revisao: "warning",
  parecer_emitido: "default",
  concluido: "success",
  cancelado: "destructive",
};

function JobsListPage() {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | "">("");

  const { data, isLoading } = useQuery({
    queryKey: ["jobs", search, status],
    queryFn: () => jobsApi.list({ search: search || undefined, status: status || undefined, limit: 50 }),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Jobs</h1>
          <p className="text-sm text-muted-foreground">Análises de crédito tributário em andamento.</p>
        </div>
        <NewJobDialog />
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9" placeholder="Buscar por número do job ou cliente…"
            value={search} onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={status || "all"} onValueChange={(v) => setStatus(v === "all" ? "" : (v as JobStatus))}>
          <SelectTrigger className="w-48"><SelectValue placeholder="Status" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os status</SelectItem>
            {Object.entries(STATUS_LABEL).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!isLoading && data?.data.length === 0 && (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">Nenhum job encontrado. Crie o primeiro com o botão acima.</p>
        </Card>
      )}

      <div className="grid gap-3">
        {data?.data.map((job) => (
          <Link key={job.id} to="/jobs/$jobId" params={{ jobId: String(job.id) }}>
            <Card className="p-4 flex items-center justify-between hover:border-primary/40 transition-colors">
              <div className="min-w-0">
                <p className="font-medium truncate">{job.job_number}</p>
                <p className="text-sm text-muted-foreground truncate">
                  {job.company_name} · {job.cnpj}
                </p>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <span className="text-xs text-muted-foreground hidden sm:inline">
                  {job.period_start} — {job.period_end}
                </span>
                <Badge variant={STATUS_VARIANT[job.status]}>{STATUS_LABEL[job.status]}</Badge>
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
