import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { jobDiagnosticApi } from "@/lib/api";
import type { JobDiagnostic } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent } from "@/components/ui/card";

type FormState = Partial<Omit<JobDiagnostic, "id" | "job_id">>;

const EMPTY: FormState = {
  pays_darf: false,
  avg_monthly_pis_cofins: null,
  avg_yearly_pis_cofins: null,
  avg_monthly_irpj_csll: null,
  avg_yearly_irpj_csll: null,
  avg_monthly_inss: null,
  avg_yearly_inss: null,
  avg_monthly_ipi: null,
  avg_yearly_ipi: null,
  collection_method: "",
  opportunities_above_500k: false,
  already_credits_risk_point: false,
  has_debts_with_rfb: false,
  usage_plan: "",
  estimated_usage_months: null,
  observations: "",
};

function BoolField({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
      <Label className="font-normal">{label}</Label>
      <Switch checked={value} onCheckedChange={onChange} />
    </div>
  );
}

function MoneyPair({
  title, monthly, yearly, onMonthly, onYearly,
}: {
  title: string; monthly: number | null; yearly: number | null;
  onMonthly: (v: number | null) => void; onYearly: (v: number | null) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3">
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{title} — média mensal (R$)</Label>
        <Input
          type="number" step="0.01" value={monthly ?? ""}
          onChange={(e) => onMonthly(e.target.value === "" ? null : Number(e.target.value))}
        />
      </div>
      <div className="space-y-1.5">
        <Label className="text-xs text-muted-foreground">{title} — média anual (R$)</Label>
        <Input
          type="number" step="0.01" value={yearly ?? ""}
          onChange={(e) => onYearly(e.target.value === "" ? null : Number(e.target.value))}
        />
      </div>
    </div>
  );
}

export function DiagnosticoForm({ jobId, onSaved }: { jobId: number; onSaved?: () => void }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["job-diagnostic", jobId],
    queryFn: () => jobDiagnosticApi.get(jobId),
  });

  const [form, setForm] = useState<FormState>(EMPTY);

  useEffect(() => {
    if (data) setForm(data);
  }, [data]);

  const mutation = useMutation({
    mutationFn: () => jobDiagnosticApi.upsert(jobId, form),
    onSuccess: () => {
      toast.success("Diagnóstico salvo.");
      queryClient.invalidateQueries({ queryKey: ["job-diagnostic", jobId] });
      onSaved?.();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar."),
  });

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando diagnóstico…</p>;

  return (
    <Card>
      <CardContent className="p-5 space-y-5">
        <BoolField label="A empresa paga DARF?" value={!!form.pays_darf} onChange={(v) => set("pays_darf", v)} />

        <MoneyPair
          title="PIS/COFINS" monthly={form.avg_monthly_pis_cofins ?? null} yearly={form.avg_yearly_pis_cofins ?? null}
          onMonthly={(v) => set("avg_monthly_pis_cofins", v)} onYearly={(v) => set("avg_yearly_pis_cofins", v)}
        />
        <MoneyPair
          title="IRPJ/CSLL" monthly={form.avg_monthly_irpj_csll ?? null} yearly={form.avg_yearly_irpj_csll ?? null}
          onMonthly={(v) => set("avg_monthly_irpj_csll", v)} onYearly={(v) => set("avg_yearly_irpj_csll", v)}
        />
        <MoneyPair
          title="INSS" monthly={form.avg_monthly_inss ?? null} yearly={form.avg_yearly_inss ?? null}
          onMonthly={(v) => set("avg_monthly_inss", v)} onYearly={(v) => set("avg_yearly_inss", v)}
        />
        <MoneyPair
          title="IPI" monthly={form.avg_monthly_ipi ?? null} yearly={form.avg_yearly_ipi ?? null}
          onMonthly={(v) => set("avg_monthly_ipi", v)} onYearly={(v) => set("avg_yearly_ipi", v)}
        />

        <div className="space-y-1.5">
          <Label>Como a empresa costuma recolher/compensar? (DARF, parcelamento, saldo credor...)</Label>
          <Textarea value={form.collection_method ?? ""} onChange={(e) => set("collection_method", e.target.value)} />
        </div>

        <BoolField
          label="Existem oportunidades acima de R$ 500 mil?"
          value={!!form.opportunities_above_500k} onChange={(v) => set("opportunities_above_500k", v)}
        />
        <BoolField
          label="Já possui créditos de ponto de risco?"
          value={!!form.already_credits_risk_point} onChange={(v) => set("already_credits_risk_point", v)}
        />
        <BoolField
          label="Possui débitos/parcelamentos com a RFB?"
          value={!!form.has_debts_with_rfb} onChange={(v) => set("has_debts_with_rfb", v)}
        />

        <div className="space-y-1.5">
          <Label>Plano de utilização (restituição, ressarcimento, escritural...)</Label>
          <Textarea value={form.usage_plan ?? ""} onChange={(e) => set("usage_plan", e.target.value)} />
        </div>

        <div className="space-y-1.5 max-w-xs">
          <Label>Tempo estimado de utilização (meses)</Label>
          <Input
            type="number" value={form.estimated_usage_months ?? ""}
            onChange={(e) => set("estimated_usage_months", e.target.value === "" ? null : Number(e.target.value))}
          />
        </div>

        <div className="space-y-1.5">
          <Label>Observações gerais</Label>
          <Textarea value={form.observations ?? ""} onChange={(e) => set("observations", e.target.value)} />
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Salvando…" : "Salvar diagnóstico"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
