//components/job-wizard/DiagnosticoPanel.tsx

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Loader2 } from "lucide-react";
import { diagnosticsApi } from "@/lib/api";
import type { DiagnosticCategory, DiagnosticTax, DiagnosticPointSummary, DiagnosticMonthlyRow } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

type Category = "ADM" | "FTX";

const CATEGORY_ORDER: Category[] = ["ADM", "FTX"];
const CATEGORY_LABEL: Record<Category, string> = { ADM: "ADM", FTX: "FTX" };

// Tributos disponíveis por categoria. FTX hoje só cobre PIS/COFINS (é o
// que o software FinTax analisa); IPI e IR/CSLL só existem como análise
// Administrativa (ADM) por enquanto.
const TAXES_BY_CATEGORY: Record<Category, DiagnosticTax[]> = {
  ADM: ["PIS_COFINS", "IPI", "IRPJ_CSLL"],
  FTX: ["PIS_COFINS"],
};

const TAX_LABEL: Record<DiagnosticTax, string> = {
  PIS_COFINS: "PIS/COFINS",
  IPI: "IPI",
  IRPJ_CSLL: "IR/CSLL",
};

const TAX_DESCRIPTION: Record<Category, Record<DiagnosticTax, string>> = {
  ADM: {
    PIS_COFINS: "Valores consolidados por ponto. Clique no nome do ponto para ver o detalhamento mês a mês.",
    IPI: "Valores consolidados por ponto de IPI (mensal, sem separação PIS/COFINS). Clique no ponto para ver o detalhamento mês a mês.",
    IRPJ_CSLL: "Valores consolidados por ponto de IRPJ/CSLL (anual). Clique no ponto para ver o detalhamento por ano.",
  },
  FTX: {
    PIS_COFINS: "Valores consolidados por ponto, com a cor de risco cadastrada no catálogo global de pontos (Administração → Pontos). Clique no nome do ponto para ver o detalhamento mês a mês.",
    IPI: "",
    IRPJ_CSLL: "",
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

// ═════════════════════════════════════════════════════════════════════════
// Linha de um ponto — genérica: mostra `total` e, se houver, as colunas de
// `breakdown` (PIS/COFINS, IRPJ/CSLL, ou nenhuma para IPI que não tem split).
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
  const queryClient = useQueryClient();
  const queryKey = ["diagnostic-points", jobId, category, tax];

  const [observations, setObservations] = useState(point.observations ?? "");

  useEffect(() => {
    setObservations(point.observations ?? "");
  }, [point.observations]);

  const noteMutation = useMutation({
    mutationFn: (data: { observations?: string }) =>
      diagnosticsApi.updateNote(jobId, point.credit_point_definition_id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar."),
  });

  function saveObservationsIfChanged() {
    if (observations === (point.observations ?? "")) return;
    noteMutation.mutate({ observations });
  }

  const displayName = point.name?.trim() || `Ponto ${point.external_id}`;

  return (
    <TableRow>
      <TableCell>
        <button
          type="button"
          onClick={() => onOpenDetail(point)}
          className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors text-left"
        >
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {displayName}
        </button>
      </TableCell>

      {showColor && (
        <TableCell>
          <Badge variant={riskBadgeVariant(point.risk_color)}>{point.risk_color ?? "—"}</Badge>
        </TableCell>
      )}

      <TableCell className="min-w-[260px]">
        <Input
          value={observations}
          onChange={(e) => setObservations(e.target.value)}
          onBlur={saveObservationsIfChanged}
          placeholder="Observações do analista…"
          className="h-8 text-sm"
        />
      </TableCell>

      {point.breakdown.map((b) => (
        <TableCell key={b.label} className="text-right text-sm whitespace-nowrap">{currency(b.value)}</TableCell>
      ))}

      <TableCell className="text-right text-sm font-medium whitespace-nowrap">{currency(point.total)}</TableCell>
    </TableRow>
  );
}

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
  const periodLabel = tax === "IRPJ_CSLL" ? "Ano" : "Mês";
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
          <DialogTitle>{displayName} — valores por {periodLabel.toLowerCase()}</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum valor encontrado para este ponto.</p>
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
                      return <TableCell key={label} className="text-right text-sm">{currency(Number(row[key]) || 0)}</TableCell>;
                    })}
                    <TableCell className="text-right text-sm font-medium">{currency(row.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell className="text-sm">Total</TableCell>
                  {totals.map((t) => <TableCell key={t.label} className="text-right text-sm">{currency(t.total)}</TableCell>)}
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

function PointsTable({ jobId, category, tax }: { jobId: number; category: Category; tax: DiagnosticTax }) {
  const [detailPoint, setDetailPoint] = useState<DiagnosticPointSummary | null>(null);

  const { data: points = [], isLoading } = useQuery({
    queryKey: ["diagnostic-points", jobId, category, tax],
    queryFn: () => diagnosticsApi.listPoints(jobId, category, tax),
  });

  const showColor = category === "FTX" && tax === "PIS_COFINS";
  const breakdownLabels = points[0]?.breakdown.map((b) => b.label) ?? [];
  const totals = breakdownLabels.map((label) => ({
    label,
    sum: points.reduce((s, p) => s + (p.breakdown.find((b) => b.label === label)?.value ?? 0), 0),
  }));
  const grandTotal = points.reduce((s, p) => s + p.total, 0);
  const colSpanBeforeTotals = 1 + (showColor ? 1 : 0) + 1; // ponto [+ cor] + observações

  return (
    <>
      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
            </div>
          ) : points.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Nenhum ponto {TAX_LABEL[tax]} importado ainda para este job. Importe os dados na aba "Coleta de Dados".
            </p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ponto</TableHead>
                    {showColor && <TableHead>Cor</TableHead>}
                    <TableHead>Observações</TableHead>
                    {breakdownLabels.map((label) => <TableHead key={label} className="text-right">{label} Total</TableHead>)}
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
                    {totals.map((t) => <TableCell key={t.label} className="text-right">{currency(t.sum)}</TableCell>)}
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

// ═════════════════════════════════════════════════════════════════════════
// Painel principal — abas ADM/FTX, com sub-abas de tributo dentro de cada uma.
// ═════════════════════════════════════════════════════════════════════════

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