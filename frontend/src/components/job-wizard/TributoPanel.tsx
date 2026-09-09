import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PlayCircle, ArrowLeft, Plus, Trash2, ArrowRight, SkipForward } from "lucide-react";
import { jobCreditAnalysisApi } from "@/lib/api";
import type { CreditPoint, CreditPointAnalysis, Contribution, Tax } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";

function currency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── Fila de revisão de um ponto de crédito ────────────────────────────────

interface RevisaoRow {
  key: string;
  month: string; // 'YYYY-MM'
  valuePis: string;
  valueCofins: string;
  valueSingle: string;
}

function newRevisaoRow(defaultMonth: string): RevisaoRow {
  return { key: crypto.randomUUID(), month: defaultMonth, valuePis: "", valueCofins: "", valueSingle: "" };
}

export function RevisaoPonto({
  jobId,
  creditPoint,
  existingAnalysis,
  periodStart,
  progressLabel,
  onDone,
  onSkip,
}: {
  jobId: number;
  creditPoint: CreditPoint;
  existingAnalysis?: CreditPointAnalysis;
  periodStart: string;
  progressLabel: string;
  onDone: () => void;
  onSkip: () => void;
}) {
  const queryClient = useQueryClient();
  const isPisCofins = creditPoint.tax_code === "PIS_COFINS";
  const defaultMonth = (periodStart || "").slice(0, 7) || new Date().toISOString().slice(0, 7);

  const [decision, setDecision] = useState<boolean | null>(existingAnalysis?.has_credit ?? null);
  const [observations, setObservations] = useState(existingAnalysis?.observations ?? "");
  const [analysisId, setAnalysisId] = useState<number | undefined>(existingAnalysis?.id);
  const [rows, setRows] = useState<RevisaoRow[]>([newRevisaoRow(defaultMonth)]);

  // Se já existe análise com crédito, carrega os valores mensais já salvos.
  const { data: detail } = useQuery({
    queryKey: ["job-credit-analysis-detail", jobId, existingAnalysis?.id],
    queryFn: () => jobCreditAnalysisApi.get(jobId, existingAnalysis!.id),
    enabled: !!existingAnalysis?.id,
  });

  useEffect(() => {
    if (!detail?.monthlyValues?.length) return;
    if (isPisCofins) {
      const byMonth = new Map<string, RevisaoRow>();
      for (const mv of detail.monthlyValues) {
        const monthKey = mv.reference_month.slice(0, 7);
        const row = byMonth.get(monthKey) ?? newRevisaoRow(monthKey);
        if (mv.contribution === "PIS") row.valuePis = String(mv.value);
        if (mv.contribution === "COFINS") row.valueCofins = String(mv.value);
        byMonth.set(monthKey, row);
      }
      setRows(Array.from(byMonth.values()));
    } else {
      setRows(
        detail.monthlyValues.map((mv) => ({
          key: crypto.randomUUID(),
          month: mv.reference_month.slice(0, 7),
          valuePis: "",
          valueCofins: "",
          valueSingle: String(mv.value),
        }))
      );
    }
  }, [detail, isPisCofins]);

  const saveDecision = useMutation({
    mutationFn: () =>
      jobCreditAnalysisApi.upsertByCreditPoint(jobId, creditPoint.id, {
        has_credit: !!decision,
        observations,
      }),
    onSuccess: (analysis) => {
      setAnalysisId(analysis.id);
      queryClient.invalidateQueries({ queryKey: ["job-credit-analyses", jobId] });
      if (!decision) {
        toast.success("Marcado como sem crédito.");
        onDone();
      }
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar decisão."),
  });

  const saveValues = useMutation({
    mutationFn: () => {
      if (!analysisId) throw new Error("Salve a decisão antes de lançar os valores.");
      const entries: Array<{ contribution?: Contribution; reference_month: string; value: number }> = [];
      for (const row of rows) {
        if (!row.month) continue;
        if (isPisCofins) {
          if (row.valuePis !== "") entries.push({ contribution: "PIS", reference_month: row.month, value: Number(row.valuePis) });
          if (row.valueCofins !== "") entries.push({ contribution: "COFINS", reference_month: row.month, value: Number(row.valueCofins) });
        } else if (row.valueSingle !== "") {
          entries.push({ reference_month: row.month, value: Number(row.valueSingle) });
        }
      }
      if (!entries.length) throw new Error("Lance ao menos um valor mensal.");
      return jobCreditAnalysisApi.bulkSetMonthlyValues(jobId, analysisId, entries);
    },
    onSuccess: (result) => {
      toast.success(`Valores salvos — total ${currency(result.total_credit_value)}.`);
      queryClient.invalidateQueries({ queryKey: ["job-credit-analyses", jobId] });
      onDone();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar valores."),
  });

  const localTotal = rows.reduce((sum, row) => {
    if (isPisCofins) return sum + (Number(row.valuePis) || 0) + (Number(row.valueCofins) || 0);
    return sum + (Number(row.valueSingle) || 0);
  }, 0);

  return (
    <Card className="max-w-2xl mx-auto">
      <CardContent className="p-6 space-y-5">
        <div className="flex items-center justify-between">
          <Badge variant="muted">{progressLabel}</Badge>
          {creditPoint.risk_color && (
            <Badge
              variant={
                creditPoint.risk_color === "VERDE" ? "success" : creditPoint.risk_color === "AMARELO" ? "warning" : "destructive"
              }
            >
              {creditPoint.risk_color}
            </Badge>
          )}
        </div>

        <div>
          <h3 className="text-lg font-display font-semibold">{creditPoint.name}</h3>
          {creditPoint.legal_criteria && (
            <p className="text-sm text-muted-foreground mt-1">{creditPoint.legal_criteria}</p>
          )}
        </div>

        <div>
          <p className="text-sm font-medium mb-2">Este ponto se aplica a este cliente?</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={decision === true ? "default" : "outline"}
              onClick={() => setDecision(true)}
              className="flex-1"
            >
              Sim, tem crédito
            </Button>
            <Button
              type="button"
              variant={decision === false ? "default" : "outline"}
              onClick={() => setDecision(false)}
              className="flex-1"
            >
              Não se aplica
            </Button>
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-sm font-medium">Observações</label>
          <Textarea
            value={observations}
            onChange={(e) => setObservations(e.target.value)}
            placeholder="Justificativa, documentos analisados, ressalvas..."
          />
        </div>

        {decision === true && (
          <div className="space-y-3 border-t border-border pt-4">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Valores mensais {isPisCofins && "(PIS e COFINS)"}</p>
              <p className="text-sm text-muted-foreground">Total: {currency(localTotal)}</p>
            </div>

            <div className="space-y-2">
              {rows.map((row, idx) => (
                <div key={row.key} className="flex items-center gap-2">
                  <Input
                    type="month"
                    value={row.month}
                    onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, month: e.target.value } : x)))}
                    className="w-40"
                  />
                  {isPisCofins ? (
                    <>
                      <Input
                        type="number" step="0.01" placeholder="PIS (R$)"
                        value={row.valuePis}
                        onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, valuePis: e.target.value } : x)))}
                      />
                      <Input
                        type="number" step="0.01" placeholder="COFINS (R$)"
                        value={row.valueCofins}
                        onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, valueCofins: e.target.value } : x)))}
                      />
                    </>
                  ) : (
                    <Input
                      type="number" step="0.01" placeholder="Valor (R$)"
                      value={row.valueSingle}
                      onChange={(e) => setRows((r) => r.map((x, i) => (i === idx ? { ...x, valueSingle: e.target.value } : x)))}
                    />
                  )}
                  <Button
                    type="button" variant="ghost" size="icon"
                    onClick={() => setRows((r) => r.filter((_, i) => i !== idx))}
                    disabled={rows.length === 1}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={() => setRows((r) => [...r, newRevisaoRow(defaultMonth)])}>
              <Plus className="h-4 w-4" /> Adicionar mês
            </Button>
          </div>
        )}

        <div className="flex items-center justify-between pt-4 border-t border-border">
          <Button type="button" variant="ghost" onClick={onSkip}>
            <SkipForward className="h-4 w-4" /> Pular por agora
          </Button>

          {decision === null ? (
            <Button disabled>Escolha uma opção acima</Button>
          ) : decision === false ? (
            <Button onClick={() => saveDecision.mutate()} disabled={saveDecision.isPending}>
              {saveDecision.isPending ? "Salvando…" : "Salvar e próximo"} <ArrowRight className="h-4 w-4" />
            </Button>
          ) : !analysisId ? (
            <Button onClick={() => saveDecision.mutate()} disabled={saveDecision.isPending}>
              {saveDecision.isPending ? "Salvando…" : "Confirmar e lançar valores"}
            </Button>
          ) : (
            <Button onClick={() => saveValues.mutate()} disabled={saveValues.isPending}>
              {saveValues.isPending ? "Salvando…" : "Salvar valores e próximo"} <ArrowRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ─── Painel do tributo (lista de pontos + progresso) ───────────────────────

export function TributoPanel({
  jobId, tax, creditPoints, analyses, periodStart,
}: {
  jobId: number;
  tax: Tax;
  creditPoints: CreditPoint[];
  analyses: CreditPointAnalysis[];
  periodStart: string;
}) {
  const [queue, setQueue] = useState<CreditPoint[] | null>(null);
  const [queueIndex, setQueueIndex] = useState(0);

  const analysisByPointId = useMemo(() => {
    const map = new Map<number, CreditPointAnalysis>();
    for (const a of analyses) map.set(a.credit_point_id, a);
    return map;
  }, [analyses]);

  const pending = creditPoints.filter((cp) => !analysisByPointId.has(cp.id));
  const reviewedCount = creditPoints.length - pending.length;
  const progressPct = creditPoints.length ? Math.round((reviewedCount / creditPoints.length) * 100) : 0;

  function startReview(points: CreditPoint[]) {
    if (!points.length) return;
    setQueue(points);
    setQueueIndex(0);
  }

  function advance() {
    if (!queue) return;
    if (queueIndex + 1 < queue.length) setQueueIndex((i) => i + 1);
    else setQueue(null);
  }

  if (queue) {
    const current = queue[queueIndex];
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" onClick={() => setQueue(null)}>
          <ArrowLeft className="h-4 w-4" /> Voltar para a lista
        </Button>
        <RevisaoPonto
          jobId={jobId}
          creditPoint={current}
          existingAnalysis={analysisByPointId.get(current.id)}
          periodStart={periodStart}
          progressLabel={`${queueIndex + 1} de ${queue.length}`}
          onDone={advance}
          onSkip={advance}
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div className="flex-1">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-sm font-medium">
              {tax.name} — {reviewedCount}/{creditPoints.length} revisados
            </p>
            <span className="text-sm text-muted-foreground">{progressPct}%</span>
          </div>
          <Progress value={progressPct} />
        </div>
        {pending.length > 0 && (
          <Button onClick={() => startReview(pending)}>
            <PlayCircle className="h-4 w-4" /> Revisar pendentes ({pending.length})
          </Button>
        )}
      </div>

      <div className="rounded-2xl border border-border divide-y divide-border overflow-hidden">
        {creditPoints.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">
            Nenhum ponto de crédito cadastrado para este tributo ainda.
          </p>
        )}
        {creditPoints.map((cp) => {
          const analysis = analysisByPointId.get(cp.id);
          return (
            <button
              key={cp.id}
              onClick={() => startReview([cp])}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left hover:bg-muted/50 transition-colors"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-sm font-medium truncate">{cp.name}</span>
                {cp.risk_color && (
                  <Badge
                    variant={cp.risk_color === "VERDE" ? "success" : cp.risk_color === "AMARELO" ? "warning" : "destructive"}
                  >
                    {cp.risk_color}
                  </Badge>
                )}
              </div>
              {!analysis ? (
                <Badge variant="muted">Não revisado</Badge>
              ) : analysis.has_credit ? (
                <Badge variant="success">Tem crédito · {currency(analysis.total_credit_value)}</Badge>
              ) : (
                <Badge variant="secondary">Sem crédito</Badge>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}