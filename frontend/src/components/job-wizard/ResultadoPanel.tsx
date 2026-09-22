// components/job-wizard/ResultadoPanel.tsx

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, CheckSquare, Download, Loader2, Square, TriangleAlert } from "lucide-react";
import { diagnosticsApi, resultadoApi } from "@/lib/api";
import type { DiagnosticCategory, DiagnosticTax, DiagnosticPointSummary } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";

const TAX_TABS: { value: DiagnosticTax; label: string }[] = [
  { value: "PIS_COFINS", label: "PIS/COFINS" },
  { value: "IPI",        label: "IPI"        },
  { value: "IRPJ_CSLL",  label: "IR/CSLL"   },
  { value: "INSS",       label: "INSS"       },
];

const CATEGORIES: DiagnosticCategory[] = ["ADM", "FTX"];

// FTX/IPI não tem slide no template (slides 15-17 só cobrem PIS/COFINS,
// INSS e IRPJ/CSLL). Avisamos o analista mas não bloqueamos a confirmação.
const NO_SLIDE_IN_PPT: Partial<Record<DiagnosticCategory, DiagnosticTax[]>> = {
  FTX: ["IPI"],
};

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function RiskBadge({ color }: { color: DiagnosticPointSummary["risk_color"] }) {
  if (!color) return null;
  const cls =
    color === "VERDE"
      ? "bg-green-100 text-green-800 border-green-200"
      : color === "AMARELO"
      ? "bg-yellow-100 text-yellow-800 border-yellow-200"
      : "bg-red-100 text-red-800 border-red-200";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold border shrink-0 ${cls}`}>
      {color}
    </span>
  );
}

// ─── PointRow ────────────────────────────────────────────────────────────────

function PointRow({
  point,
  jobId,
  category,
  tax,
}: {
  point: DiagnosticPointSummary;
  jobId: number;
  category: DiagnosticCategory;
  tax: DiagnosticTax;
}) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (confirmed: boolean) =>
      resultadoApi.toggleConfirm(jobId, point.credit_point_definition_id, confirmed),
    onSuccess: (_, confirmed) => {
      // Invalida a queryKey exata desta aba (category + tax)
      queryClient.invalidateQueries({
        queryKey: ["diagnostic-points", jobId, category, tax],
      });
      // Invalida também as queryKeys "sem tax" que $jobId.tsx usa para o
      // progresso global — assim o % de Resultado no header atualiza junto.
      queryClient.invalidateQueries({
        queryKey: ["diagnostic-points", jobId, category],
        exact: false,
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao confirmar ponto."),
  });

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
      <button
        type="button"
        role="checkbox"
        aria-checked={point.confirmed}
        onClick={() => mutation.mutate(!point.confirmed)}
        disabled={mutation.isPending}
        className={`h-5 w-5 shrink-0 rounded border flex items-center justify-center transition-colors ${
          point.confirmed
            ? "bg-green-600 border-green-600 text-white"
            : "border-input hover:border-primary bg-background"
        }`}
      >
        {mutation.isPending ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : point.confirmed ? (
          <Check className="h-3.5 w-3.5" />
        ) : null}
      </button>

      <RiskBadge color={point.risk_color} />

      <span className="text-sm flex-1 min-w-0 truncate">
        {point.name || `ID ${point.external_id}`}
      </span>

      <span className="text-sm font-medium tabular-nums shrink-0">
        {formatCurrency(point.total)}
      </span>
    </div>
  );
}

// ─── CategoryTaxTable ─────────────────────────────────────────────────────────

function CategoryTaxTable({
  jobId,
  category,
  tax,
}: {
  jobId: number;
  category: DiagnosticCategory;
  tax: DiagnosticTax;
}) {
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["diagnostic-points", jobId, category, tax],
    queryFn: () => diagnosticsApi.listPoints(jobId, category, tax),
  });

  const noSlide = NO_SLIDE_IN_PPT[category]?.includes(tax);
  const confirmedCount = data.filter((p) => p.confirmed).length;
  const confirmedTotal = data
    .filter((p) => p.confirmed)
    .reduce((acc, p) => acc + p.total, 0);

  const allConfirmed = data.length > 0 && confirmedCount === data.length;

  // Mutação em lote para "Selecionar todos / Desselecionar todos"
  const bulkMutation = useMutation({
    mutationFn: async (confirm: boolean) => {
      const targets = data.filter((p) => p.confirmed !== confirm);
      await Promise.all(
        targets.map((p) =>
          resultadoApi.toggleConfirm(jobId, p.credit_point_definition_id, confirm)
        )
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["diagnostic-points", jobId, category, tax],
      });
      queryClient.invalidateQueries({
        queryKey: ["diagnostic-points", jobId, category],
        exact: false,
      });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar pontos."),
  });

  if (isLoading) {
    return <p className="text-sm text-muted-foreground py-6">Carregando…</p>;
  }

  if (data.length === 0) {
    return (
      <Card className="p-8 text-center">
        <p className="text-sm text-muted-foreground">
          Nenhum ponto de {category} / {tax.replace("_", "/")} importado neste job ainda.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {noSlide && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          Este tributo não tem slide na apresentação final para FTX. Confirmar aqui
          não altera o PPT gerado.
        </div>
      )}

      <div className="flex items-center justify-between text-sm text-muted-foreground px-1">
        <span>
          {confirmedCount} de {data.length} ponto(s) confirmado(s)
        </span>
        <span className="font-medium text-foreground">
          {formatCurrency(confirmedTotal)} confirmado
        </span>
      </div>

      <Card className="overflow-hidden">
        {/* Cabeçalho com "Selecionar todos" */}
        <div className="flex items-center gap-3 px-4 py-2.5 bg-muted/40 border-b border-border">
          <button
            type="button"
            onClick={() => bulkMutation.mutate(!allConfirmed)}
            disabled={bulkMutation.isPending}
            className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            {bulkMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : allConfirmed ? (
              <CheckSquare className="h-4 w-4 text-green-600" />
            ) : (
              <Square className="h-4 w-4" />
            )}
            {allConfirmed ? "Desselecionar todos" : "Selecionar todos"}
          </button>
        </div>

        {data.map((point) => (
          <PointRow
            key={point.credit_point_definition_id}
            point={point}
            jobId={jobId}
            category={category}
            tax={tax}
          />
        ))}
      </Card>
    </div>
  );
}

// ─── ResultadoPanel ───────────────────────────────────────────────────────────

export function ResultadoPanel({
  jobId,
  jobNumber,
}: {
  jobId: number;
  jobNumber?: string;
}) {
  const [category, setCategory] = useState<DiagnosticCategory>("ADM");
  const [tax, setTax] = useState<DiagnosticTax>("PIS_COFINS");

  // ── Contagem de confirmados para habilitar o botão de gerar PPT ──────────
  // IMPORTANTE: usamos a mesma queryKey ["diagnostic-points", jobId, category, tax]
  // que CategoryTaxTable usa — assim lemos do cache já populado, sem chamada
  // extra. Consultamos TODAS as combinações relevantes para o PPT (4 ADM + 3 FTX).
  const allRelevantQueries = useQueries({
    queries: [
      ...CATEGORIES.flatMap((cat) =>
        TAX_TABS.map(({ value: t }) => ({
          queryKey: ["diagnostic-points", jobId, cat, t] as const,
          queryFn: () => diagnosticsApi.listPoints(jobId, cat, t),
          // Não faz fetch automático — só usa o cache se já existir.
          // Quando o usuário navega pela aba, o CategoryTaxTable já fez o fetch.
          staleTime: 30_000,
        }))
      ),
    ],
  });

  const totalConfirmados = useMemo(() => {
    return allRelevantQueries.reduce((acc, q) => {
      return acc + (q.data?.filter((p) => p.confirmed).length ?? 0);
    }, 0);
  }, [allRelevantQueries]);

  const generateMutation = useMutation({
    mutationFn: () => resultadoApi.generatePpt(jobId, jobNumber),
    onSuccess: () => toast.success("Apresentação gerada com sucesso."),
    onError: (err) =>
      toast.error(
        err instanceof Error ? err.message : "Erro ao gerar a apresentação."
      ),
  });

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-display font-semibold">Resultado</h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            Confirme os pontos que devem entrar na apresentação final. Só os pontos
            marcados como "OK" aparecem nos slides de oportunidades (ADM) e de pontos
            Fintax (FTX).
          </p>
        </div>

        <Button
          onClick={() => generateMutation.mutate()}
          disabled={generateMutation.isPending || totalConfirmados === 0}
        >
          {generateMutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Gerar Apresentação ({totalConfirmados} confirmado
          {totalConfirmados !== 1 ? "s" : ""})
        </Button>
      </div>

      {/* Seletor de categoria (ADM / FTX) */}
      <div className="flex gap-2">
        {CATEGORIES.map((c) => (
          <Button
            key={c}
            variant={category === c ? "default" : "outline"}
            size="sm"
            onClick={() => setCategory(c)}
          >
            {c}
          </Button>
        ))}
      </div>

      {/* Abas de tributo */}
      <div className="flex gap-1 border-b border-border">
        {TAX_TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTax(t.value)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tax === t.value
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tabela */}
      <CategoryTaxTable jobId={jobId} category={category} tax={tax} />
    </div>
  );
}