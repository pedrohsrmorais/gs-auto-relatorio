// components/job-wizard/DiagnosticoPanel.tsx

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Loader2, CheckCircle2, AlertCircle, Clock, MessageSquare, Star } from "lucide-react";
import { diagnosticsApi } from "@/lib/api";
import type {
  DiagnosticCategory, DiagnosticTax, DiagnosticPointSummary,
  DiagnosticMonthlyRow, ReviewStatus,
} from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

type Category = "ADM" | "FTX";

const CATEGORY_ORDER: Category[] = ["ADM", "FTX"];
const CATEGORY_LABEL: Record<Category, string> = { ADM: "ADM", FTX: "FTX" };

const TAXES_BY_CATEGORY: Record<Category, DiagnosticTax[]> = {
  ADM: ["PIS_COFINS", "IPI", "IRPJ_CSLL", "INSS"],
  FTX: ["PIS_COFINS", "IPI", "IRPJ_CSLL", "INSS"],
};

const TAX_LABEL: Record<DiagnosticTax, string> = {
  PIS_COFINS: "PIS/COFINS",
  IPI: "IPI",
  IRPJ_CSLL: "IR/CSLL",
  INSS: "INSS",
};

const TAX_DESCRIPTION: Record<Category, Record<DiagnosticTax, string>> = {
  ADM: {
    PIS_COFINS: "Valores consolidados por ponto. Clique no nome do ponto para ver o detalhamento mês a mês.",
    IPI: "Valores consolidados por ponto de IPI (mensal, sem separação PIS/COFINS). Clique no ponto para ver o detalhamento mês a mês.",
    IRPJ_CSLL: "Valores consolidados por ponto de IRPJ/CSLL (anual). Clique no ponto para ver o detalhamento por ano.",
    INSS: "Valores consolidados por ponto de INSS (anual, sem split). Clique no ponto para ver o detalhamento por ano.",
  },
  FTX: {
    PIS_COFINS: "Valores consolidados por ponto, com a cor de risco cadastrada no catálogo global de pontos (Administração → Pontos). Clique no nome do ponto para ver o detalhamento mês a mês.",
    IPI: "Valores consolidados por ponto de IPI vindo do catálogo FTX (FinTax), mensal, sem separação PIS/COFINS.",
    IRPJ_CSLL: "Valores consolidados por ponto de IRPJ/CSLL vindo do catálogo FTX (FinTax), anual. Clique no ponto para ver o detalhamento por ano.",
    INSS: "Valores consolidados por ponto de INSS vindo do catálogo FTX, anual, com a cor de risco cadastrada em Administração → Pontos.",
  },
};

function currency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function riskBadgeVariant(color: string | null) {
  if (color === "VERDE") return "success" as const;
  if (color === "AMARELO") return "warning" as const;
  if (color === "VERMELHO") return "destructive" as const;
  return "muted" as const;
}

// ─── Indicador de review_status ───────────────────────────────────────────────

function ReviewStatusBadge({ status, reviewNote }: { status: ReviewStatus; reviewNote: string | null }) {
  if (status === "APPROVED") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Aprovado
          </span>
        </TooltipTrigger>
        <TooltipContent>Análise validada pelo administrador.</TooltipContent>
      </Tooltip>
    );
  }

  if (status === "NEEDS_REVIEW") {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex items-center gap-1 text-xs font-medium text-destructive cursor-help">
            <AlertCircle className="h-3.5 w-3.5" />
            Revisar
          </span>
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          <p className="font-medium mb-1">Nota do administrador:</p>
          <p>{reviewNote ?? "—"}</p>
        </TooltipContent>
      </Tooltip>
    );
  }

  // PENDING — só mostra ícone se tiver observations (análise escrita aguardando validação)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
          <Clock className="h-3.5 w-3.5" />
          Pendente
        </span>
      </TooltipTrigger>
      <TooltipContent>Aguardando validação do administrador.</TooltipContent>
    </Tooltip>
  );
}

// ─── Modal de devolução (admin) ───────────────────────────────────────────────

function NeedsReviewDialog({
  open,
  onOpenChange,
  onConfirm,
  isPending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note: string) => void;
  isPending: boolean;
}) {
  const [note, setNote] = useState("");

  function handleConfirm() {
    if (!note.trim()) {
      toast.error("Escreva uma nota antes de devolver.");
      return;
    }
    onConfirm(note.trim());
    setNote("");
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setNote(""); onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <MessageSquare className="h-4 w-4" />
            Devolver para revisão
          </DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">
          Descreva o que o analista deve corrigir ou complementar nesta análise.
        </p>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Ex: O valor informado não bate com o SPED M610. Por favor revise o cálculo do crédito de março/2024."
          className="min-h-[100px] text-sm"
          autoFocus
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancelar</Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={isPending || !note.trim()}
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
            Devolver
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// PointRow
// ═════════════════════════════════════════════════════════════════════════

function PointRow({
  jobId, category, tax, point, showColor, onOpenDetail,
}: {
  jobId: number;
  category: Category;
  tax: DiagnosticTax;
  point: DiagnosticPointSummary;
  showColor: boolean;
  onOpenDetail: (point: DiagnosticPointSummary) => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const queryClient = useQueryClient();
  const queryKey = ["diagnostic-points", jobId, category, tax];
  const progressKey = ["diagnostic-progress", jobId];

  const [observations, setObservations] = useState(point.observations ?? "");
  const [needsReviewOpen, setNeedsReviewOpen] = useState(false);

  useEffect(() => {
    setObservations(point.observations ?? "");
  }, [point.observations]);

  // ── Salvar observações (analista ou admin) ─────────────────────────────────
  const noteMutation = useMutation({
    mutationFn: (data: { observations?: string }) =>
      diagnosticsApi.updateNote(jobId, point.credit_point_definition_id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: progressKey });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar."),
  });

  function saveObservationsIfChanged() {
    if (observations === (point.observations ?? "")) return;
    noteMutation.mutate({ observations });
  }

  // ── Aprovar / Devolver (admin) ─────────────────────────────────────────────
  const reviewMutation = useMutation({
    mutationFn: ({ status, note }: { status: "APPROVED" | "NEEDS_REVIEW"; note?: string }) =>
      diagnosticsApi.reviewPoint(jobId, point.credit_point_definition_id, status, note),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: progressKey });
      if (result.meta.all_points_approved) {
        toast.success("Todos os pontos estão aprovados! O job pode avançar para o Resultado.");
      } else {
        toast.success(
          result.data.review_status === "APPROVED"
            ? "Ponto aprovado."
            : "Ponto devolvido para revisão."
        );
      }
      setNeedsReviewOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao revisar ponto."),
  });

  const displayName = point.name?.trim() || `Ponto ${point.external_id}`;
  const hasObservations = (point.observations ?? "").trim().length > 0;

  return (
    <>
      <TableRow className={point.review_status === "NEEDS_REVIEW" ? "bg-destructive/5" : undefined}>
        {/* Nome do ponto */}
        <TableCell>
          <button
            type="button"
            onClick={() => onOpenDetail(point)}
            className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors text-left"
          >
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            {/* Ícone de ponto prioritário/fixo */}
            {point.is_fixed_point && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Star className="h-3 w-3 text-amber-500 fill-current shrink-0" />
                </TooltipTrigger>
                <TooltipContent className="text-xs">Ponto prioritário — sempre exibido</TooltipContent>
              </Tooltip>
            )}
            {displayName}
          </button>
        </TableCell>

        {/* Cor de risco (FTX) */}
        {showColor && (
          <TableCell>
            <Badge variant={riskBadgeVariant(point.risk_color)}>{point.risk_color ?? "—"}</Badge>
          </TableCell>
        )}

        {/* Observações — editável por qualquer um */}
        <TableCell className="min-w-[260px]">
          <div className="space-y-1">
            <Input
              value={observations}
              onChange={(e) => setObservations(e.target.value)}
              onBlur={saveObservationsIfChanged}
              placeholder="Observações do analista…"
              className={`h-8 text-sm ${
                point.review_status === "NEEDS_REVIEW"
                  ? "border-destructive focus-visible:ring-destructive/30"
                  : ""
              }`}
            />
            {/* Nota do admin visível abaixo do input quando NEEDS_REVIEW */}
            {point.review_status === "NEEDS_REVIEW" && point.review_note && (
              <p className="text-xs text-destructive flex items-start gap-1">
                <MessageSquare className="h-3 w-3 mt-0.5 shrink-0" />
                {point.review_note}
              </p>
            )}
          </div>
        </TableCell>

        {/* Status de revisão — só aparece se há observações */}
        <TableCell className="whitespace-nowrap">
          {hasObservations ? (
            <ReviewStatusBadge status={point.review_status} reviewNote={point.review_note} />
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          )}
        </TableCell>

        {/* Ações de revisão — admin only, só quando há observações */}
        {isAdmin && (
          <TableCell className="whitespace-nowrap">
            {hasObservations && point.review_status !== "APPROVED" && (
              <div className="flex items-center gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-success border-success/40 hover:bg-success/10"
                  onClick={() => reviewMutation.mutate({ status: "APPROVED" })}
                  disabled={reviewMutation.isPending}
                >
                  {reviewMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3 w-3 mr-1" />
                  )}
                  Aprovar
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => setNeedsReviewOpen(true)}
                  disabled={reviewMutation.isPending}
                >
                  <AlertCircle className="h-3 w-3 mr-1" />
                  Devolver
                </Button>
              </div>
            )}
            {hasObservations && point.review_status === "APPROVED" && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs text-muted-foreground"
                onClick={() => reviewMutation.mutate({ status: "NEEDS_REVIEW", note: "Revisão solicitada pelo administrador." })}
                disabled={reviewMutation.isPending}
              >
                Reabrir
              </Button>
            )}
          </TableCell>
        )}

        {/* Valores de breakdown (PIS, COFINS, IRPJ, CSLL...) */}
        {point.breakdown.map((b) => (
          <TableCell key={b.label} className="text-right text-sm whitespace-nowrap">
            {currency(b.value)}
          </TableCell>
        ))}

        {/* Total */}
        <TableCell className="text-right text-sm font-medium whitespace-nowrap">
          {currency(point.total)}
        </TableCell>
      </TableRow>

      <NeedsReviewDialog
        open={needsReviewOpen}
        onOpenChange={setNeedsReviewOpen}
        onConfirm={(note) => reviewMutation.mutate({ status: "NEEDS_REVIEW", note })}
        isPending={reviewMutation.isPending}
      />
    </>
  );
}

// ─── DetailModal ──────────────────────────────────────────────────────────────

function DetailModal({
  jobId, category, tax, point, onOpenChange,
}: {
  jobId: number;
  category: Category;
  tax: DiagnosticTax;
  point: DiagnosticPointSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["diagnostic-points-detail", jobId, category, tax, point?.credit_point_definition_id],
    queryFn: () => diagnosticsApi.getMonthly(jobId, point!.credit_point_definition_id, category, tax),
    enabled: !!point,
  });

  const displayName = point ? (point.name?.trim() || `Ponto ${point.external_id}`) : "";
  const periodLabel = (tax === "IRPJ_CSLL" || tax === "INSS") ? "Ano" : "Mês";
  const breakdownLabels = point?.breakdown.map((b) => b.label) ?? [];

  const totals = breakdownLabels.map((label) => ({
    label,
    total: data.reduce((s: number, r: DiagnosticMonthlyRow) => {
      const key = `${label.toLowerCase()}_value` as keyof DiagnosticMonthlyRow;
      return s + (Number(r[key]) || 0);
    }, 0),
  }));
  const grandTotal = data.reduce((s: number, r: DiagnosticMonthlyRow) => s + r.total, 0);

  return (
    <Dialog open={!!point} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              {point?.is_fixed_point && (
                <Star className="h-3.5 w-3.5 text-amber-500 fill-current shrink-0" />
              )}
              {displayName} — valores por {periodLabel.toLowerCase()}
            </span>
          </DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">
            {point?.is_fixed_point
              ? "Este ponto prioritário ainda não tem dados importados para este job."
              : "Nenhum valor encontrado para este ponto."}
          </p>
        ) : (
          <div className="border border-border rounded-lg overflow-auto max-h-[50vh]">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>{periodLabel}</TableHead>
                  {breakdownLabels.map((label) => <TableHead key={label} className="text-right">{label}</TableHead>)}
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row: DiagnosticMonthlyRow) => (
                  <TableRow key={row.period_label}>
                    <TableCell className="text-sm">{row.period_label}</TableCell>
                    {breakdownLabels.map((label) => {
                      const key = `${label.toLowerCase()}_value` as keyof DiagnosticMonthlyRow;
                      return (
                        <TableCell key={label} className="text-right text-sm">
                          {currency(Number(row[key]) || 0)}
                        </TableCell>
                      );
                    })}
                    <TableCell className="text-right text-sm font-medium">{currency(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell className="text-sm">Total</TableCell>
                  {totals.map((t) => (
                    <TableCell key={t.label} className="text-right text-sm">{currency(t.total)}</TableCell>
                  ))}
                  <TableCell className="text-right text-sm">{currency(grandTotal)}</TableCell>
                </TableRow>
              </tfoot>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── PointsTable ──────────────────────────────────────────────────────────────

function PointsTable({ jobId, category, tax }: { jobId: number; category: Category; tax: DiagnosticTax }) {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [detailPoint, setDetailPoint] = useState<DiagnosticPointSummary | null>(null);

  const { data: points = [], isLoading } = useQuery({
    queryKey: ["diagnostic-points", jobId, category, tax],
    queryFn: () => diagnosticsApi.listPoints(jobId, category, tax),
  });

  const showColor = category === "FTX";
  const breakdownLabels = points[0]?.breakdown.map((b) => b.label) ?? [];
  const totals = breakdownLabels.map((label) => ({
    label,
    sum: points.reduce((s, p) => s + (p.breakdown.find((b) => b.label === label)?.value ?? 0), 0),
  }));
  const grandTotal = points.reduce((s, p) => s + p.total, 0);

  // Ponto + [Cor] + Observações + Status + [Ações admin] = colunas antes dos valores
  const colSpanBeforeTotals = 1 + (showColor ? 1 : 0) + 1 + 1 + (isAdmin ? 1 : 0);

  // Resumo de validação no topo da tabela
  const approvedCount = points.filter((p) => p.review_status === "APPROVED").length;
  const withObsCount = points.filter((p) => (p.observations ?? "").trim().length > 0).length;
  const needsReviewCount = points.filter((p) => p.review_status === "NEEDS_REVIEW").length;
  const fixedCount = points.filter((p) => p.is_fixed_point).length;

  return (
    <>
      {/* Resumo de progresso da tabela atual */}
      {(withObsCount > 0 || fixedCount > 0) && (
        <div className="flex items-center gap-4 text-xs text-muted-foreground pb-1">
          {withObsCount > 0 && (
            <span className="flex items-center gap-1 text-success">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {approvedCount} aprovado(s)
            </span>
          )}
          {needsReviewCount > 0 && (
            <span className="flex items-center gap-1 text-destructive">
              <AlertCircle className="h-3.5 w-3.5" />
              {needsReviewCount} para revisar
            </span>
          )}
          {withObsCount > 0 && (
            <span className="text-muted-foreground/60">
              {withObsCount} de {points.length} com análise
            </span>
          )}
          {fixedCount > 0 && (
            <span className="flex items-center gap-1 text-amber-600">
              <Star className="h-3.5 w-3.5 fill-current" />
              {fixedCount} prioritário{fixedCount !== 1 ? "s" : ""}
            </span>
          )}
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
            </div>
          ) : points.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Nenhum ponto {TAX_LABEL[tax]} encontrado para este job. Importe os dados na aba "Coleta de Dados" ou cadastre pontos prioritários em Administração → Pontos.
            </p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ponto</TableHead>
                    {showColor && <TableHead>Cor</TableHead>}
                    <TableHead>Observações</TableHead>
                    <TableHead>Status</TableHead>
                    {isAdmin && <TableHead>Ações</TableHead>}
                    {breakdownLabels.map((label) => (
                      <TableHead key={label} className="text-right">{label} Total</TableHead>
                    ))}
                    <TableHead className="text-right">Crédito Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((point) => (
                    <PointRow
                      key={point.credit_point_definition_id}
                      jobId={jobId}
                      category={category}
                      tax={tax}
                      point={point}
                      showColor={showColor}
                      onOpenDetail={setDetailPoint}
                    />
                  ))}
                </TableBody>
                <tfoot>
                  <TableRow className="bg-muted/40 font-medium">
                    <TableCell colSpan={colSpanBeforeTotals}>Total {TAX_LABEL[tax]}</TableCell>
                    {totals.map((t) => (
                      <TableCell key={t.label} className="text-right">{currency(t.sum)}</TableCell>
                    ))}
                    <TableCell className="text-right">{currency(grandTotal)}</TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <DetailModal
        jobId={jobId}
        category={category}
        tax={tax}
        point={detailPoint}
        onOpenChange={(open) => { if (!open) setDetailPoint(null); }}
      />
    </>
  );
}

// ─── DiagnosticoPanel ─────────────────────────────────────────────────────────

export function DiagnosticoPanel({ jobId }: { jobId: number }) {
  const [category, setCategory] = useState<Category>("ADM");
  const [tax, setTax] = useState<DiagnosticTax>("PIS_COFINS");

  const availableTaxes = TAXES_BY_CATEGORY[category];

  function handleCategoryChange(next: Category) {
    setCategory(next);
    if (!TAXES_BY_CATEGORY[next].includes(tax)) {
      setTax(TAXES_BY_CATEGORY[next][0]);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <p className="text-sm font-medium shrink-0">Diagnóstico — créditos por tributo</p>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1 shrink-0">
          {CATEGORY_ORDER.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => handleCategoryChange(c)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                category === c ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {CATEGORY_LABEL[c]}
            </button>
          ))}
        </div>
      </div>

      {availableTaxes.length > 1 && (
        <div className="flex items-center gap-1 border-b border-border">
          {availableTaxes.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTax(t)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
                tax === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"
              }`}
            >
              {TAX_LABEL[t]}
            </button>
          ))}
        </div>
      )}

      <p className="text-sm text-muted-foreground min-h-[1.5rem]">{TAX_DESCRIPTION[category][tax]}</p>

      <PointsTable jobId={jobId} category={category} tax={tax} />
    </div>
  );
}