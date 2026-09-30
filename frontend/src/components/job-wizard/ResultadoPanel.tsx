// components/job-wizard/ResultadoPanel.tsx

import { useMemo, useState } from "react";
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Check, CheckSquare, Download, FileText, FileBarChart2,
  Loader2, Square, TriangleAlert, Star,
} from "lucide-react";
import { diagnosticsApi, resultadoApi } from "@/lib/api";
import type {
  DiagnosticCategory, DiagnosticTax, DiagnosticPointSummary, DiagnosticPdfFormData,
} from "@/lib/api";
import { Button }   from "@/components/ui/button";
import { Badge }    from "@/components/ui/badge";
import { Card }     from "@/components/ui/card";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Label }    from "@/components/ui/label";
import { Input }    from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";

// ─── Constantes ───────────────────────────────────────────────────────────────

const TAX_TABS: { value: DiagnosticTax; label: string }[] = [
  { value: "PIS_COFINS", label: "PIS/COFINS" },
  { value: "IPI",        label: "IPI"        },
  { value: "IRPJ_CSLL",  label: "IR/CSLL"   },
  { value: "INSS",       label: "INSS"       },
];

const CATEGORIES: DiagnosticCategory[] = ["ADM", "FTX"];

// FTX/IPI não tem slide no template — avisamos mas não bloqueamos.
const NO_SLIDE_IN_PPT: Partial<Record<DiagnosticCategory, DiagnosticTax[]>> = {
  FTX: ["IPI"],
};

const EMPTY_DIAG_FORM: DiagnosticPdfFormData = {
  q1_paga_darf:         "",
  q2_pis_cofins_mes:    0,
  q2_irpj_csll_mes:     0,
  q2_inss_mes:          0,
  q2_ipi_mes:           0,
  q3_recolhimento:      "",
  q4_oportunidades_500k:"",
  q5_credita_risco:     "",
  q6_dividas_rfb:       "",
  q7_explique:          "",
  obs:                  "",
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function formatCurrency(value: number) {
  return value.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

// ─── RiskBadge ────────────────────────────────────────────────────────────────

function RiskBadge({ color }: { color: DiagnosticPointSummary["risk_color"] }) {
  if (!color) return null;
  const cls =
    color === "VERDE"
      ? "bg-green-100 text-green-800 border-green-200"
      : color === "AMARELO"
      ? "bg-yellow-100 text-yellow-800 border-yellow-200"
      : "bg-red-100 text-red-800 border-red-200";
  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-semibold border shrink-0 ${cls}`}
    >
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

      {point.is_fixed_point && (
        <Tooltip>
          <TooltipTrigger asChild>
            <Star className="h-3 w-3 text-amber-500 fill-current shrink-0" />
          </TooltipTrigger>
          <TooltipContent className="text-xs">Ponto prioritário</TooltipContent>
        </Tooltip>
      )}

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

  const noSlide       = NO_SLIDE_IN_PPT[category]?.includes(tax);
  const confirmedCount = data.filter((p) => p.confirmed).length;
  const confirmedTotal = data
    .filter((p) => p.confirmed)
    .reduce((acc, p) => acc + p.total, 0);
  const allConfirmed  = data.length > 0 && confirmedCount === data.length;

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
          Nenhum ponto de {category} / {tax.replace("_", "/")} encontrado para este job.
        </p>
      </Card>
    );
  }

  return (
    <div className="space-y-2">
      {noSlide && (
        <div className="flex items-center gap-2 text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          <TriangleAlert className="h-3.5 w-3.5 shrink-0" />
          Este tributo não tem slide na apresentação final para FTX. Confirmar aqui não altera o PPT gerado.
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

// ─── ParecerModal ─────────────────────────────────────────────────────────────

function ParecerModal({
  open,
  onOpenChange,
  jobId,
  jobNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: number;
  jobNumber?: string;
}) {
  const [obs, setObs]         = useState("");
  const [atesto, setAtesto]   = useState(false);
  const [confirm, setConfirm] = useState("");

  const canSubmit =
    obs.trim().length > 0 &&
    atesto &&
    confirm.trim().toLowerCase() === "sim";

  const mutation = useMutation({
    mutationFn: () =>
      resultadoApi.generateParecer(jobId, { observations: obs }, jobNumber),
    onSuccess: () => {
      toast.success("Parecer gerado com sucesso.");
      onOpenChange(false);
      setObs("");
      setAtesto(false);
      setConfirm("");
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao gerar o parecer."),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-primary" />
            Gerar Parecer Técnico
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5 py-2">
          {/* Observações */}
          <div className="space-y-1.5">
            <Label htmlFor="parecer-obs">
              Observações Técnicas <span className="text-destructive">*</span>
            </Label>
            <Textarea
              id="parecer-obs"
              value={obs}
              onChange={(e) => setObs(e.target.value)}
              placeholder="Descreva as observações técnicas que irão compor a Seção 3 do parecer…"
              rows={7}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Este texto será inserido na área de Observações Técnicas do documento PDF.
            </p>
          </div>

          {/* Checkbox atesto */}
          <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-muted/30">
            <Checkbox
              id="parecer-atesto"
              checked={atesto}
              onCheckedChange={(v) => setAtesto(!!v)}
            />
            <Label htmlFor="parecer-atesto" className="leading-snug cursor-pointer">
              Atesto que as informações contidas nas observações acima são verdadeiras e
              de responsabilidade do signatário.
            </Label>
          </div>

          {/* Confirmação "sim" */}
          <div className="space-y-1.5">
            <Label htmlFor="parecer-confirm">
              Para confirmar a geração, digite <strong>sim</strong> abaixo
            </Label>
            <Input
              id="parecer-confirm"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              placeholder='Digite "sim" para confirmar'
              autoComplete="off"
            />
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            onClick={() => mutation.mutate()}
            disabled={!canSubmit || mutation.isPending}
          >
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Gerar Parecer PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── DiagnosticoModal ─────────────────────────────────────────────────────────

function DiagnosticoModal({
  open,
  onOpenChange,
  jobId,
  jobNumber,
  companyName,
  taxRegime,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: number;
  jobNumber?: string;
  companyName?: string;
  taxRegime?: string;
}) {
  const [form, setForm] = useState<DiagnosticPdfFormData>(EMPTY_DIAG_FORM);

  const set = (key: keyof DiagnosticPdfFormData) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value }));

  const setNum = (key: keyof DiagnosticPdfFormData) =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setForm((prev) => ({ ...prev, [key]: parseFloat(e.target.value) || 0 }));

  const mutation = useMutation({
    mutationFn: () => diagnosticsApi.generatePdf(jobId, form, jobNumber),
    onSuccess: () => {
      toast.success("Diagnóstico PDF gerado com sucesso.");
      onOpenChange(false);
      setForm(EMPTY_DIAG_FORM);
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao gerar o PDF."),
  });

  const q2Items: { label: string; key: keyof DiagnosticPdfFormData }[] = [
    { label: "PIS/COFINS", key: "q2_pis_cofins_mes" },
    { label: "IRPJ/CSLL",  key: "q2_irpj_csll_mes"  },
    { label: "INSS",       key: "q2_inss_mes"        },
    { label: "IPI",        key: "q2_ipi_mes"         },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileBarChart2 className="h-5 w-5 text-primary" />
            Gerar Diagnóstico PDF
          </DialogTitle>
        </DialogHeader>

        {/* scrollable body */}
        <div className="overflow-y-auto flex-1 pr-1 space-y-5 py-1">

          {/* Header do job (readonly) */}
          <div className="grid grid-cols-3 gap-3">
            {[
              { label: "Nº JOB",            value: jobNumber  ?? `#${jobId}` },
              { label: "Razão Social",       value: companyName ?? "—"        },
              { label: "Regime de Apuração", value: taxRegime   ?? "—"        },
            ].map(({ label, value }) => (
              <div key={label} className="space-y-1">
                <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide">
                  {label}
                </p>
                <p className="text-sm font-medium truncate">{value}</p>
              </div>
            ))}
          </div>

          <hr className="border-border" />

          {/* Q1 */}
          <div className="space-y-1.5">
            <Label htmlFor="q1">1. A empresa paga DARF?</Label>
            <Input id="q1" value={form.q1_paga_darf} onChange={set("q1_paga_darf")} placeholder="Sim / Não / Parcialmente…" />
          </div>

          {/* Q2 — tabela de valores */}
          <div className="space-y-2">
            <Label>2. Qual o valor médio por Tributo/mês?</Label>
            <div className="rounded-md border border-border overflow-hidden">
              {/* header */}
              <div className="grid grid-cols-3 bg-muted/60 text-[11px] font-semibold text-muted-foreground uppercase tracking-wide px-3 py-2">
                <span>Tributo</span>
                <span>Valor Médio / Mês</span>
                <span className="text-muted-foreground/70">Estimativa Anual (×12)</span>
              </div>
              {q2Items.map(({ label, key }) => {
                const mes = (form[key] as number) || 0;
                return (
                  <div
                    key={key}
                    className="grid grid-cols-3 items-center gap-3 px-3 py-2 border-t border-border"
                  >
                    <span className="text-sm font-medium">{label}</span>
                    <Input
                      type="number"
                      min={0}
                      step={0.01}
                      value={mes || ""}
                      onChange={setNum(key)}
                      placeholder="0,00"
                      className="h-8 text-sm"
                    />
                    <span className="text-sm text-muted-foreground tabular-nums">
                      {formatCurrency(mes * 12)}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Q3 */}
          <div className="space-y-1.5">
            <Label htmlFor="q3">3. Como é realizado o recolhimento dos débitos?</Label>
            <Textarea id="q3" value={form.q3_recolhimento} onChange={set("q3_recolhimento")} rows={2} className="resize-none" placeholder="Descreva o processo de recolhimento…" />
          </div>

          {/* Q4 */}
          <div className="space-y-1.5">
            <Label htmlFor="q4">4. As oportunidades somam valor maior que R$ 500.000,00?</Label>
            <Input id="q4" value={form.q4_oportunidades_500k} onChange={set("q4_oportunidades_500k")} placeholder="Sim / Não…" />
          </div>

          {/* Q5 */}
          <div className="space-y-1.5">
            <Label htmlFor="q5">5. A empresa já se credita de algum ponto de Risco?</Label>
            <Input id="q5" value={form.q5_credita_risco} onChange={set("q5_credita_risco")} placeholder="Sim / Não / Quais…" />
          </div>

          {/* Q6 */}
          <div className="space-y-1.5">
            <Label htmlFor="q6">6. Empresa possui dívidas com a RFB?</Label>
            <Input id="q6" value={form.q6_dividas_rfb} onChange={set("q6_dividas_rfb")} placeholder="Sim / Não / Em negociação…" />
          </div>

          {/* Q7 */}
          <div className="space-y-1.5">
            <Label htmlFor="q7">7. Como a empresa irá utilizar os valores?</Label>
            <div className="space-y-1">
              <p className="text-xs text-muted-foreground">Explique:</p>
              <Textarea
                id="q7"
                value={form.q7_explique}
                onChange={set("q7_explique")}
                rows={3}
                className="resize-none"
                placeholder="Descreva como a empresa pretende utilizar os créditos…"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              As tabelas de Crédito ADM e Risco FINTAX serão geradas no PDF a partir dos pontos importados.
            </p>
          </div>

          {/* Obs */}
          <div className="space-y-1.5">
            <Label htmlFor="obs">Obs:</Label>
            <Textarea
              id="obs"
              value={form.obs}
              onChange={set("obs")}
              rows={2}
              className="resize-none"
              placeholder="Observações adicionais…"
            />
          </div>
        </div>

        <DialogFooter className="gap-2 pt-2 border-t border-border mt-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Gerar Diagnóstico PDF
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─── ResultadoPanel ───────────────────────────────────────────────────────────

export function ResultadoPanel({
  jobId,
  jobNumber,
  companyName,
  taxRegime,
}: {
  jobId: number;
  jobNumber?: string;
  /** Nome da empresa — exibido no modal de Diagnóstico */
  companyName?: string;
  /** Regime de apuração — exibido no modal de Diagnóstico */
  taxRegime?: string;
}) {
  const [category, setCategory] = useState<DiagnosticCategory>("ADM");
  const [tax, setTax]           = useState<DiagnosticTax>("PIS_COFINS");

  // Modais
  const [parecerOpen, setParecerOpen]   = useState(false);
  const [diagOpen,    setDiagOpen]      = useState(false);

  // ── Contagem de confirmados para habilitar o botão de gerar PPT ──────────
  const allRelevantQueries = useQueries({
    queries: [
      ...CATEGORIES.flatMap((cat) =>
        TAX_TABS.map(({ value: t }) => ({
          queryKey: ["diagnostic-points", jobId, cat, t] as const,
          queryFn:  () => diagnosticsApi.listPoints(jobId, cat, t),
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
    onSuccess:  () => toast.success("Apresentação gerada com sucesso."),
    onError:    (err) =>
      toast.error(
        err instanceof Error ? err.message : "Erro ao gerar a apresentação."
      ),
  });

  return (
    <div className="space-y-6">
      {/* Modais */}
      <ParecerModal
        open={parecerOpen}
        onOpenChange={setParecerOpen}
        jobId={jobId}
        jobNumber={jobNumber}
      />
      <DiagnosticoModal
        open={diagOpen}
        onOpenChange={setDiagOpen}
        jobId={jobId}
        jobNumber={jobNumber}
        companyName={companyName}
        taxRegime={taxRegime}
      />

      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-lg font-display font-semibold">Resultado</h2>
          <p className="text-sm text-muted-foreground max-w-xl">
            Confirme os pontos que devem entrar na apresentação final. Só os pontos marcados
            como "OK" aparecem nos slides de oportunidades (ADM) e de pontos Fintax (FTX).
            Pontos prioritários (⭐) aparecem sempre — mesmo sem dados importados.
          </p>
        </div>

        {/* Botões de geração */}
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => setDiagOpen(true)}
          >
            <FileBarChart2 className="h-4 w-4" />
            Gerar Diagnóstico PDF
          </Button>

          <Button
            variant="outline"
            onClick={() => setParecerOpen(true)}
          >
            <FileText className="h-4 w-4" />
            Gerar Parecer
          </Button>

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