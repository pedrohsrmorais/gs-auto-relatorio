// routes/jobs/$jobId.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, Circle, ClipboardList, Building2, UploadCloud, FileCheck2 } from "lucide-react";
import {
  jobsApi, perdcompApi, darfApi, spedM400Api, spedM610Api,
  pontosAdmApi, pontosFtxApi, diagnosticsApi,
} from "@/lib/api";
import type { DiagnosticCategory, DiagnosticTax, JobStatus } from "@/lib/api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { ColetaPanel } from "@/components/job-wizard/ColetaPanel";
import { DiagnosticoPanel } from "@/components/job-wizard/DiagnosticoPanel";
import { ResultadoPanel } from "@/components/job-wizard/ResultadoPanel";
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
  { value: "diagnostico",     label: "Diagnóstico"     },
  { value: "em_analise",      label: "Em análise"      },
  { value: "revisao",         label: "Revisão"         },
  { value: "parecer_emitido", label: "Parecer emitido" },
  { value: "concluido",       label: "Concluído"       },
  { value: "cancelado",       label: "Cancelado"       },
];

// Todas as combinações que o ResultadoPanel busca (para manter as queryKeys
// idênticas entre $jobId e ResultadoPanel → mesmo cache, sem fetch duplo).
const DIAGNOSTIC_COMBOS: { category: DiagnosticCategory; tax: DiagnosticTax }[] = [
  { category: "ADM", tax: "PIS_COFINS" },
  { category: "ADM", tax: "IPI"        },
  { category: "ADM", tax: "IRPJ_CSLL"  },
  { category: "ADM", tax: "INSS"       },
  { category: "FTX", tax: "PIS_COFINS" },
  { category: "FTX", tax: "IPI"        },
  { category: "FTX", tax: "IRPJ_CSLL"  },
  { category: "FTX", tax: "INSS"       },
];

// ─── OverviewPanel ────────────────────────────────────────────────────────────

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
                {STATUS_OPTIONS.map((s) => (
                  <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                ))}
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

// ─── useJobProgress ───────────────────────────────────────────────────────────
//
// Lógica de progresso em 4 estágios conforme acordado:
//
//   Coleta (imports):          peso 33% do total
//   Diagnóstico (análises):    peso 22% (chega a 55% combinado)
//   Diagnóstico (validações):  peso 25% (chega a 80% combinado)
//   Resultado (PPT gerado):    peso 20% (chega a 100%)
//
// Na prática exibimos 3 barras separadas na UI:
//   coletaPct      → 0-100 de quantas fontes têm dados
//   diagnosticoPct → 0-100 calculado pelo backend via getProgress()
//                    (combina análises escritas + validações aprovadas)
//   resultadoPct   → 0-100 de quantos pontos foram confirmados no Resultado
//
// O overallPct mapeia os 3 para a escala de 4 estágios:
//   0%  → sem imports
//   33% → tem imports, sem análises
//   55% → tem análises escritas, sem validação
//   80% → validações completas (all_approved), sem PPT
//   100%→ PPT gerado (resultadoPct = 100%)

function useJobProgress(jobId: number) {
  // ── Coleta: 6 fontes de dados ──────────────────────────────────────────────
  const sourceQueries = useQueries({
    queries: [
      { queryKey: ["perdcomps",    jobId], queryFn: () => perdcompApi.list(jobId)  },
      { queryKey: ["darf-entries", jobId], queryFn: () => darfApi.list(jobId)      },
      { queryKey: ["sped-m400",    jobId], queryFn: () => spedM400Api.list(jobId)  },
      { queryKey: ["sped-m610",    jobId], queryFn: () => spedM610Api.list(jobId)  },
      { queryKey: ["pontos-adm",   jobId], queryFn: () => pontosAdmApi.list(jobId) },
      { queryKey: ["pontos-ftx",   jobId], queryFn: () => pontosFtxApi.list(jobId) },
    ],
  });

  const importedSourcesCount = sourceQueries.filter((q) => (q.data?.length ?? 0) > 0).length;
  const coletaPct = Math.round((importedSourcesCount / sourceQueries.length) * 100);

  // ── Diagnóstico: usa o endpoint dedicado do backend ───────────────────────
  // getProgress() retorna { PENDING, NEEDS_REVIEW, APPROVED, total, percentage, all_approved }
  // onde percentage = APPROVED/total * 100
  const { data: diagProgress } = useQuery({
    queryKey: ["diagnostic-progress", jobId],
    queryFn: () => diagnosticsApi.getProgress(jobId),
    staleTime: 30_000,
  });

  // Percentual de análises escritas (qualquer ponto com observations != null)
  // = (PENDING + NEEDS_REVIEW + APPROVED) / total — que é simplesmente
  // diagProgress.total / totalPossível. Como não temos totalPossível facilmente,
  // usamos o % de aprovação como proxy do estágio de validação, e presence de
  // total > 0 como proxy do estágio de análise.
  const hasAnyAnalysis = (diagProgress?.total ?? 0) > 0;
  const allApproved = diagProgress?.all_approved ?? false;
  const approvalPct = diagProgress?.percentage ?? 0; // 0-100 de aprovados

  // diagnosticoPct para exibição na barra individual (0-100)
  // Representa: escreveu análises + foram validadas
  const diagnosticoPct = !hasAnyAnalysis
    ? 0
    : allApproved
    ? 100
    : Math.min(Math.round(approvalPct * 0.7), 70); // chega a 70% quando tudo está pending/needs_review

  // ── Resultado: pontos confirmados em todas as combinações ─────────────────
  const diagnosticQueries = useQueries({
    queries: DIAGNOSTIC_COMBOS.map(({ category, tax }) => ({
      queryKey: ["diagnostic-points", jobId, category, tax] as const,
      queryFn: () => diagnosticsApi.listPoints(jobId, category, tax),
      staleTime: 30_000,
    })),
  });

  const totalAllPoints = diagnosticQueries.reduce(
    (acc, q) => acc + (q.data?.length ?? 0), 0
  );
  const confirmedPoints = diagnosticQueries.reduce(
    (acc, q) => acc + (q.data?.filter((p) => p.confirmed).length ?? 0), 0
  );
  const resultadoPct = totalAllPoints
    ? Math.round((confirmedPoints / totalAllPoints) * 100)
    : 0;

  // ── Overall: mapeamento nos 4 estágios ────────────────────────────────────
  let overallPct: number;
  if (resultadoPct === 100) {
    overallPct = 100;
  } else if (allApproved) {
    // Validações completas + progresso do resultado
    overallPct = 80 + Math.round(resultadoPct * 0.20);
  } else if (hasAnyAnalysis) {
    // Tem análises escritas, parcialmente ou totalmente validadas
    overallPct = 55 + Math.round(approvalPct * 0.25);
  } else if (importedSourcesCount > 0) {
    // Tem imports, sem análises ainda
    overallPct = 33 + Math.round(coletaPct * 0.22);
  } else {
    // Só imports parciais ou nenhum
    overallPct = Math.round(coletaPct * 0.33);
  }

  return { coletaPct, diagnosticoPct, resultadoPct, overallPct, allApproved };
}

// ─── JobWizardPage ────────────────────────────────────────────────────────────

type Section = "overview" | "coleta" | "diagnostico" | "resultado";

function JobWizardPage() {
  const { jobId: jobIdParam } = Route.useParams();
  const jobId = Number(jobIdParam);

  const [section, setSection] = useState<Section>("overview");

  const { data: job } = useQuery({ queryKey: ["job", jobId], queryFn: () => jobsApi.get(jobId) });

  const { coletaPct, diagnosticoPct, resultadoPct, overallPct } = useJobProgress(jobId);

  if (!job) return <p className="text-sm text-muted-foreground">Carregando job…</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs text-muted-foreground uppercase tracking-wide">{job.job_number}</p>
        <h1 className="text-2xl font-display font-semibold">{job.company_name}</h1>
        <div className="flex items-center gap-3 mt-2 max-w-md">
          <Progress value={overallPct} className="flex-1" />
          <span className="text-sm text-muted-foreground shrink-0">{overallPct}% concluído</span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          Coleta de Dados: {coletaPct}% · Diagnóstico: {diagnosticoPct}% · Resultado: {resultadoPct}%
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-6">
        <nav className="space-y-1">
          <SectionLink
            active={section === "overview"}
            onClick={() => setSection("overview")}
            icon={<ClipboardList className="h-4 w-4" />}
            label="Dados do Job"
            done
          />
          <SectionLink
            active={section === "coleta"}
            onClick={() => setSection("coleta")}
            icon={coletaPct === 100
              ? <CheckCircle2 className="h-4 w-4 text-success" />
              : <UploadCloud className="h-4 w-4" />}
            label="Coleta de Dados"
            sublabel={`${coletaPct}%`}
            done={coletaPct === 100}
          />
          <SectionLink
            active={section === "diagnostico"}
            onClick={() => setSection("diagnostico")}
            icon={diagnosticoPct === 100
              ? <CheckCircle2 className="h-4 w-4 text-success" />
              : <Circle className="h-4 w-4" />}
            label="Diagnóstico"
            sublabel={`${diagnosticoPct}%`}
            done={diagnosticoPct === 100}
          />
          <SectionLink
            active={section === "resultado"}
            onClick={() => setSection("resultado")}
            icon={resultadoPct === 100
              ? <CheckCircle2 className="h-4 w-4 text-success" />
              : <FileCheck2 className="h-4 w-4" />}
            label="Resultado"
            sublabel={`${resultadoPct}%`}
            done={resultadoPct === 100}
          />
        </nav>

        <div>
          {section === "overview"    && <OverviewPanel jobId={jobId} />}
          {section === "coleta"      && <ColetaPanel jobId={jobId} />}
          {section === "diagnostico" && <DiagnosticoPanel jobId={jobId} />}
          {section === "resultado" && (
            <ResultadoPanel
              jobId={job.id}
              jobNumber={job.job_number}
              companyName={job.company_name}
              taxRegime={job.tax_regime ?? undefined}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── SectionLink ──────────────────────────────────────────────────────────────

function SectionLink({
  active, onClick, icon, label, sublabel, done,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  done?: boolean;
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
      {sublabel && (
        <span className="text-xs text-muted-foreground shrink-0">{sublabel}</span>
      )}
    </button>
  );
}