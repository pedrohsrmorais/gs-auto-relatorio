import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronRight, Loader2 } from "lucide-react";
import { diagnosticsApi } from "@/lib/api";
import type { DiagnosticCategory, DiagnosticPointSummary, DiagnosticMonthlyRow } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";

function currency(v: number) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function formatMonth(dateStr: string) {
  const [year, month] = dateStr.slice(0, 7).split("-");
  return `${month}/${year}`;
}

function riskBadgeVariant(color: DiagnosticPointSummary["risk_color"]) {
  if (color === "VERDE") return "success" as const;
  if (color === "AMARELO") return "warning" as const;
  if (color === "VERMELHO") return "destructive" as const;
  return "muted" as const;
}

// ─── Linha de um ponto (observação editável + cor editável) ────────────────

function PointRow({
  jobId, category, point, onOpenMonthly,
}: {
  jobId: number;
  category: DiagnosticCategory;
  point: DiagnosticPointSummary;
  onOpenMonthly: (point: DiagnosticPointSummary) => void;
}) {
  const queryClient = useQueryClient();
  const queryKey = ["diagnostic-points", jobId, category];

  const [observations, setObservations] = useState(point.observations ?? "");

  useEffect(() => {
    setObservations(point.observations ?? "");
  }, [point.observations]);

  const noteMutation = useMutation({
    mutationFn: (data: { risk_color?: DiagnosticPointSummary["risk_color"]; observations?: string }) =>
      diagnosticsApi.updateNote(jobId, point.credit_point_definition_id, data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar."),
  });

  function saveObservationsIfChanged() {
    if (observations === (point.observations ?? "")) return;
    noteMutation.mutate({ observations });
  }

  function saveColor(color: string) {
    noteMutation.mutate({ risk_color: color === "NONE" ? null : (color as DiagnosticPointSummary["risk_color"]) });
  }

  const displayName = point.name?.trim() || `Ponto ${point.external_id}`;

  return (
    <TableRow>
      <TableCell>
        <button
          type="button"
          onClick={() => onOpenMonthly(point)}
          className="flex items-center gap-1.5 text-sm font-medium hover:text-primary transition-colors text-left"
        >
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          {displayName}
        </button>
      </TableCell>

      {category === "FTX" && (
        <TableCell>
          <Select value={point.risk_color ?? "NONE"} onValueChange={saveColor}>
            <SelectTrigger className="w-32 h-8">
              <SelectValue>
                <Badge variant={riskBadgeVariant(point.risk_color)}>{point.risk_color ?? "— sem cor —"}</Badge>
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="NONE">— sem cor —</SelectItem>
              <SelectItem value="VERDE">VERDE</SelectItem>
              <SelectItem value="AMARELO">AMARELO</SelectItem>
              <SelectItem value="VERMELHO">VERMELHO</SelectItem>
            </SelectContent>
          </Select>
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

      <TableCell className="text-right text-sm whitespace-nowrap">{currency(point.pis_total)}</TableCell>
      <TableCell className="text-right text-sm whitespace-nowrap">{currency(point.cofins_total)}</TableCell>
      <TableCell className="text-right text-sm font-medium whitespace-nowrap">{currency(point.total)}</TableCell>
    </TableRow>
  );
}

// ─── Modal de detalhamento mensal (PIS/COFINS mês a mês) ───────────────────

function MonthlyModal({
  jobId, category, point, onOpenChange,
}: {
  jobId: number;
  category: DiagnosticCategory;
  point: DiagnosticPointSummary | null;
  onOpenChange: (open: boolean) => void;
}) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["diagnostic-points-monthly", jobId, category, point?.credit_point_definition_id],
    queryFn: () => diagnosticsApi.getMonthly(jobId, point!.credit_point_definition_id, category),
    enabled: !!point,
  });

  const displayName = point ? (point.name?.trim() || `Ponto ${point.external_id}`) : "";
  const totalPis = data.reduce((s: number, r: DiagnosticMonthlyRow) => s + r.pis_value, 0);
  const totalCofins = data.reduce((s: number, r: DiagnosticMonthlyRow) => s + r.cofins_value, 0);

  return (
    <Dialog open={!!point} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{displayName} — valores mês a mês</DialogTitle>
        </DialogHeader>

        {isLoading ? (
          <div className="flex items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
          </div>
        ) : data.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">Nenhum valor mensal encontrado para este ponto.</p>
        ) : (
          <div className="border border-border rounded-lg overflow-auto max-h-[50vh]">
            <Table>
              <TableHeader className="sticky top-0 bg-card z-10">
                <TableRow>
                  <TableHead>Mês</TableHead>
                  <TableHead className="text-right">PIS</TableHead>
                  <TableHead className="text-right">COFINS</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((row: DiagnosticMonthlyRow) => (
                  <TableRow key={row.reference_month}>
                    <TableCell className="text-sm">{formatMonth(row.reference_month)}</TableCell>
                    <TableCell className="text-right text-sm">{currency(row.pis_value)}</TableCell>
                    <TableCell className="text-right text-sm">{currency(row.cofins_value)}</TableCell>
                    <TableCell className="text-right text-sm font-medium">
                      {currency(row.pis_value + row.cofins_value)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
              <tfoot>
                <TableRow className="bg-muted/40 font-medium">
                  <TableCell className="text-sm">Total</TableCell>
                  <TableCell className="text-right text-sm">{currency(totalPis)}</TableCell>
                  <TableCell className="text-right text-sm">{currency(totalCofins)}</TableCell>
                  <TableCell className="text-right text-sm">{currency(totalPis + totalCofins)}</TableCell>
                </TableRow>
              </tfoot>
            </Table>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Painel principal ───────────────────────────────────────────────────────

export function DiagnosticoPanel({ jobId }: { jobId: number }) {
  const [category, setCategory] = useState<DiagnosticCategory>("ADM");
  const [monthlyPoint, setMonthlyPoint] = useState<DiagnosticPointSummary | null>(null);

  const { data: points = [], isLoading } = useQuery({
    queryKey: ["diagnostic-points", jobId, category],
    queryFn: () => diagnosticsApi.listPoints(jobId, category),
  });

  const totalPis = points.reduce((s, p) => s + p.pis_total, 0);
  const totalCofins = points.reduce((s, p) => s + p.cofins_total, 0);
  const totalGeral = totalPis + totalCofins;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <p className="text-sm font-medium">Diagnóstico — créditos PIS/COFINS</p>
          <p className="text-sm text-muted-foreground">
            Valores consolidados por ponto. Clique no nome do ponto para ver o detalhamento mês a mês.
          </p>
        </div>
        <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
          <button
            type="button"
            onClick={() => setCategory("ADM")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              category === "ADM" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ADM
          </button>
          <button
            type="button"
            onClick={() => setCategory("FTX")}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
              category === "FTX" ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            FTX
          </button>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mr-2" /> Carregando…
            </div>
          ) : points.length === 0 ? (
            <p className="text-sm text-muted-foreground py-10 text-center">
              Nenhum ponto {category} importado ainda para este job. Importe os dados na aba "Coleta de Dados".
            </p>
          ) : (
            <div className="overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ponto</TableHead>
                    {category === "FTX" && <TableHead>Cor</TableHead>}
                    <TableHead>Observações</TableHead>
                    <TableHead className="text-right">PIS Total</TableHead>
                    <TableHead className="text-right">COFINS Total</TableHead>
                    <TableHead className="text-right">Crédito Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {points.map((point) => (
                    <PointRow
                      key={point.credit_point_definition_id}
                      jobId={jobId}
                      category={category}
                      point={point}
                      onOpenMonthly={setMonthlyPoint}
                    />
                  ))}
                </TableBody>
                <tfoot>
                  <TableRow className="bg-muted/40 font-medium">
                    <TableCell colSpan={category === "FTX" ? 3 : 2}>Total {category}</TableCell>
                    <TableCell className="text-right">{currency(totalPis)}</TableCell>
                    <TableCell className="text-right">{currency(totalCofins)}</TableCell>
                    <TableCell className="text-right">{currency(totalGeral)}</TableCell>
                  </TableRow>
                </tfoot>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <MonthlyModal
        jobId={jobId}
        category={category}
        point={monthlyPoint}
        onOpenChange={(open) => { if (!open) setMonthlyPoint(null); }}
      />
    </div>
  );
}