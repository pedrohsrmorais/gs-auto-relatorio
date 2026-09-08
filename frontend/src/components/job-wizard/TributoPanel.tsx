import { useMemo, useState } from "react";
import { PlayCircle, ArrowLeft } from "lucide-react";
import type { CreditPoint, CreditPointAnalysis, Tax } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { RevisaoPonto } from "@/components/job-wizard/RevisaoPonto";

function currency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

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
