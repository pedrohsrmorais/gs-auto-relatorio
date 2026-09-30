import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Trash2, AlertCircle } from "lucide-react";
import { jobsApi, diagnosticsApi } from "@/lib/api";
import type { Job, JobStatus } from "@/lib/types";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import { NewJobDialog } from "@/components/NewJobDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

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

// ─── Flag de validação pendente (admin only) ──────────────────────────────────
// Busca individualmente o progresso de cada job. O componente só é renderizado
// quando isAdmin=true, então analistas nunca disparam essas queries.

function DiagnosticFlag({ jobId }: { jobId: number }) {
  const { data: progress } = useQuery({
    queryKey: ["diagnostic-progress", jobId],
    queryFn: () => diagnosticsApi.getProgress(jobId),
    staleTime: 60_000,
  });

  // Sem dados ainda ou nenhum ponto com observação → sem flag
  if (!progress || progress.total === 0) return null;

  // Todos aprovados → sem flag (está tudo OK)
  if (progress.all_approved) return null;

  // Há pontos PENDING ou NEEDS_REVIEW → mostrar flag
  const needsReviewCount = progress.NEEDS_REVIEW;
  const pendingCount = progress.PENDING;

  const tooltipText = [
    needsReviewCount > 0 && `${needsReviewCount} ponto(s) devolvido(s) aguardando correção do analista`,
    pendingCount > 0 && `${pendingCount} ponto(s) com análise aguardando sua validação`,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="flex items-center gap-1 text-xs font-medium text-warning shrink-0">
          <AlertCircle className="h-4 w-4" />
          {progress.NEEDS_REVIEW > 0 ? "Correção pendente" : "Validação pendente"}
        </span>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-xs text-xs">
        {tooltipText}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── JobsListPage ─────────────────────────────────────────────────────────────

function JobsListPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<JobStatus | "">("");
  const [deleteTarget, setDeleteTarget] = useState<Job | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["jobs", search, status],
    queryFn: () => jobsApi.list({ search: search || undefined, status: status || undefined, limit: 50 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => jobsApi.remove(id),
    onSuccess: () => {
      toast.success("Job excluído.");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao excluir job."),
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
          <div key={job.id} className="relative">
            <Link to="/jobs/$jobId" params={{ jobId: String(job.id) }}>
              <Card className={`p-4 flex items-center justify-between gap-3 hover:border-primary/40 transition-colors ${isAdmin ? "pr-14" : ""}`}>
                <div className="min-w-0 flex-1">
                  <p className="font-medium truncate">{job.job_number}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {job.company_name} · {job.cnpj}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  {/* Flag de validação pendente — só para admins */}
                  {isAdmin && <DiagnosticFlag jobId={job.id} />}
                  <span className="text-xs text-muted-foreground hidden sm:inline">
                    {job.period_start} — {job.period_end}
                  </span>
                  <Badge variant={STATUS_VARIANT[job.status]}>{STATUS_LABEL[job.status]}</Badge>
                </div>
              </Card>
            </Link>
            {isAdmin && (
              <Button
                variant="ghost" size="icon"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                onClick={(e) => { e.preventDefault(); setDeleteTarget(job); }}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        ))}
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir job "{deleteTarget?.job_number}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Isso apaga permanentemente todos os dados deste job: PER/DCOMP, DARF, SPED, valores de pontos
            ADM/FTX, observações do diagnóstico, equipe e pareceres. Não afeta o cadastro do cliente
            nem o catálogo global de pontos.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Excluindo…" : "Sim, excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}