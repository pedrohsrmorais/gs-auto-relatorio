import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, ClipboardList, Building2, UploadCloud } from "lucide-react";
import { jobsApi, taxesApi, creditPointsApi, jobCreditAnalysisApi, jobDiagnosticApi } from "@/lib/api";
import type { JobStatus } from "@/lib/types";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ColetaPanel } from "@/components/job-wizard/ColetaPanel";
import { DiagnosticoForm } from "@/components/job-wizard/DiagnosticoForm";
import { TributoPanel } from "@/components/job-wizard/TributoPanel";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Card, CardContent } from "@/components/ui/card";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export const Route = createFileRoute("/jobs/$jobId")({
  component: () => (
    <ProtectedRoute>
      <JobWizardPage />
    </ProtectedRoute>
  ),
});

const STATUS_OPTIONS: { value: JobStatus; label: string }[] = [
  { value: "diagnostico", label: "Diagnóstico" },
  { value: "em_analise", label: "Em análise" },
  { value: "revisao", label: "Revisão" },
  { value: "parecer_emitido", label: "Parecer emitido" },
  { value: "concluido", label: "Concluído" },
  { value: "cancelado", label: "Cancelado" },
];

function OverviewPanel({ jobId }: { jobId: number }) {
  const queryClient = useQueryClient();
  const { data: job } = useQuery({ queryKey: ["job", jobId], queryFn: () => jobsApi.get(jobId) });

  const statusMutation = useMutation({
    mutationFn: (status: JobStatus) => jobsApi.updateStatus(jobId, status),
    onSuccess: () => {
      toast.success("Status atualizado.");
      queryClient.invalidateQueries({ queryKey: ["job", jobId] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao atualizar status."),
  });

  if (!job) return null;

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2.5">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <div>
                <p className="font-medium">{job.company_name}</p>
                <p className="text-sm text-muted-foreground">{job.cnpj}</p>
              </div>
            </div>
            <Select value={job.status} onValueChange={(v) => statusMutation.mutate(v as JobStatus)}>
              <SelectTrigger className="w-44"><SelectValue /></SelectTrigger>
              <SelectContent>
                {STATUS_OPTIONS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm pt-3 border-t border-border">
            <div>
              <p className="text-muted-foreground text-xs">Período</p>
              <p>{job.period_start} — {job.period_end}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Regime tributário</p>
              <p>{job.tax_regime ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Segmento</p>
              <p>{job.segment ?? job.client_segment ?? "—"}</p>
            </div>
            <div>
              <p className="text-muted-foreground text-xs">Nº do Job</p>
              <p>{job.job_number}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5">
          <p className="text-sm font-medium mb-3">Equipe</p>
          {job.team.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum membro atribuído ainda.</p>
          ) : (
            <div className="space-y-2">
              {job.team.map((member) => (
                <div key={member.id} className="flex items-center justify-between text-sm">
                  <span>{member.name}</span>
                  <Badge variant="secondary">{member.role_in_job.replaceAll("_", " ")}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function JobWizardPage() {
  const { jobId: jobIdParam } = Route.useParams();
  const jobId = Number(jobIdParam);

  const [section, setSection] = useState<string>("overview");

  const { data: job } = useQuery({ queryKey: ["job", jobId], queryFn: () => jobsApi.get(jobId) });
  const { data: taxes = [] } = useQuery({ queryKey: ["taxes"], queryFn: taxesApi.list });
  const { data: creditPointsPage } = useQuery({
    queryKey: ["credit-points-all"],
    queryFn: () => creditPointsApi.list({ is_active: true, limit: 200 }),
  });
  const { data: analyses = [] } = useQuery({
    queryKey: ["job-credit-analyses", jobId],
    queryFn: () => jobCreditAnalysisApi.list(jobId, {}),
  });
  const { data: diagnostic } = useQuery({
    queryKey: ["job-diagnostic", jobId],
    queryFn: () => jobDiagnosticApi.get(jobId),
  });

  const creditPoints = useMemo(() => creditPointsPage?.data ?? [], [creditPointsPage]);

  const creditPointsByTax = useMemo(() => {
    const map = new Map<number, typeof creditPoints>();
    for (const cp of creditPoints) {
      const list = map.get(cp.tax_id) ?? [];
      list.push(cp);
      map.set(cp.tax_id, list);
    }
    return map;
  }, [creditPoints]);

  const overallReviewed = analyses.length;
  const overallTotal = creditPoints.length;
  const overallPct = overallTotal ? Math.round((overallReviewed / overallTotal) * 100) : 0;

  if (!job) return <p className="text-sm text-muted-foreground">Carregando job…</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{job.job_number}</p>
        <h1 className="text-2xl font-display font-semibold">{job.company_name}</h1>
        <div className="flex items-center gap-3 mt-2 max-w-md">
          <Progress value={overallPct} className="flex-1" />
          <span className="text-sm text-muted-foreground shrink-0">
            {overallReviewed}/{overallTotal} pontos · {overallPct}%
          </span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <nav className="space-y-1">
          <SectionLink
            active={section === "overview"} onClick={() => setSection("overview")}
            icon={<ClipboardList className="h-4 w-4" />} label="Dados do Job" done
          />
          <SectionLink
            active={section === "coleta"} onClick={() => setSection("coleta")}
            icon={<UploadCloud className="h-4 w-4" />} label="Coleta de Dados"
          />
          <SectionLink
            active={section === "diagnostico"} onClick={() => setSection("diagnostico")}
            icon={diagnostic ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4" />}
            label="Diagnóstico" done={!!diagnostic}
          />
          {taxes.map((tax) => {
            const points = creditPointsByTax.get(tax.id) ?? [];
            const reviewed = analyses.filter((a) => a.tax_code === tax.code).length;
            const complete = points.length > 0 && reviewed === points.length;
            return (
              <SectionLink
                key={tax.id}
                active={section === `tax-${tax.id}`}
                onClick={() => setSection(`tax-${tax.id}`)}
                icon={complete ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4" />}
                label={tax.name}
                sublabel={`${reviewed}/${points.length}`}
                done={complete}
              />
            );
          })}
        </nav>

        <div>
          {section === "overview" && <OverviewPanel jobId={jobId} />}
          {section === "coleta" && <ColetaPanel jobId={jobId} />}
          {section === "diagnostico" && <DiagnosticoForm jobId={jobId} />}
          {taxes.map((tax) =>
            section === `tax-${tax.id}` ? (
              <TributoPanel
                key={tax.id}
                jobId={jobId}
                tax={tax}
                creditPoints={creditPointsByTax.get(tax.id) ?? []}
                analyses={analyses}
                periodStart={job.period_start}
              />
            ) : null
          )}
        </div>
      </div>
    </div>
  );
}

function SectionLink({
  active, onClick, icon, label, sublabel, done,
}: {
  active: boolean; onClick: () => void; icon: React.ReactNode; label: string; sublabel?: string; done?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-sm font-medium text-left transition-colors ${
        active ? "bg-primary/15 text-primary" : "text-foreground/70 hover:bg-muted"
      }`}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span className={done ? "text-success" : "text-muted-foreground"}>{icon}</span>
        <span className="truncate">{label}</span>
      </span>
      {sublabel && <span className="text-xs text-muted-foreground shrink-0">{sublabel}</span>}
    </button>
  );
}