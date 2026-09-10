import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, FileUp, UserPlus, ArrowLeft } from "lucide-react";
import { jobsApi, clientsApi } from "@/lib/api";
import type { TaxRegime } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { IdentificationImportModal } from "@/components/data-import/ImportWizards";

const TAX_REGIME_OPTIONS: TaxRegime[] = ["Lucro Real", "Lucro Presumido", "Simples Nacional", "Lucro Arbitrado"];

function normalize(s: string) {
  return s.trim().toLowerCase();
}

export function NewJobDialog() {
  const [open, setOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  const [jobNumber, setJobNumber] = useState("");
  const [companySearch, setCompanySearch] = useState("");
  const [clientId, setClientId] = useState<number | "">("");
  const [periodStart, setPeriodStart] = useState("");
  const [periodEnd, setPeriodEnd] = useState("");
  const [taxRegime, setTaxRegime] = useState<TaxRegime | "">("");
  const [segment, setSegment] = useState("");

  // ─── Criação rápida de cliente ────────────────────────────────────────
  const [creatingClient, setCreatingClient] = useState(false);
  const [newClientCnpj, setNewClientCnpj] = useState("");
  const [newClientName, setNewClientName] = useState("");

  const queryClient = useQueryClient();

  const { data: clientsPage } = useQuery({
    queryKey: ["clients-search", companySearch],
    queryFn: () => clientsApi.list({ search: companySearch || undefined, limit: 10 }),
    enabled: companySearch.length >= 2,
  });

  // Auto-seleciona quando o texto buscado bate exatamente com um cliente já
  // cadastrado — cobre o caso de vir preenchido pela importação do Relatório 1.
  useEffect(() => {
    if (clientId || !clientsPage || companySearch.length < 2) return;
    const exact = clientsPage.data.find((c) => normalize(c.company_name) === normalize(companySearch));
    if (exact) setClientId(exact.id);
  }, [clientsPage, companySearch, clientId]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!clientId) throw new Error("Selecione ou informe o cliente.");
      return jobsApi.create({
        job_number: jobNumber,
        client_id: clientId,
        period_start: periodStart,
        period_end: periodEnd,
        tax_regime: taxRegime || undefined,
        segment: segment || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Job criado.");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      setOpen(false);
      reset();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao criar job."),
  });

  const createClientMutation = useMutation({
    mutationFn: () => {
      if (!newClientCnpj.trim() || !newClientName.trim()) {
        throw new Error("Informe CNPJ e razão social do novo cliente.");
      }
      return clientsApi.create({ cnpj: newClientCnpj, company_name: newClientName });
    },
    onSuccess: (client) => {
      toast.success("Cliente cadastrado.");
      setClientId(client.id);
      setCompanySearch(client.company_name);
      setCreatingClient(false);
      setNewClientCnpj("");
      setNewClientName("");
      queryClient.invalidateQueries({ queryKey: ["clients-search"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao cadastrar cliente."),
  });

  function reset() {
    setJobNumber(""); setCompanySearch(""); setClientId("");
    setPeriodStart(""); setPeriodEnd(""); setTaxRegime(""); setSegment("");
    setCreatingClient(false); setNewClientCnpj(""); setNewClientName("");
  }

  function openCreateClient() {
    setNewClientName(companySearch);
    setNewClientCnpj("");
    setCreatingClient(true);
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4" /> Novo job</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader className="flex-row items-center justify-between">
          <DialogTitle>Novo job</DialogTitle>
          <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
            <FileUp className="h-4 w-4" /> Importar do Relatório 1
          </Button>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nº do Job</Label>
            <Input value={jobNumber} onChange={(e) => setJobNumber(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Cliente (busque pelo nome)</Label>

            {!creatingClient ? (
              <>
                <Input
                  value={companySearch}
                  onChange={(e) => { setCompanySearch(e.target.value); setClientId(""); }}
                  placeholder="Digite ao menos 2 letras…"
                />

                {companySearch.length >= 2 && !clientId && (
                  <div className="border border-border rounded-lg divide-y divide-border max-h-40 overflow-auto">
                    {clientsPage && clientsPage.data.length > 0 ? (
                      clientsPage.data.map((c) => (
                        <button
                          key={c.id} type="button"
                          className="w-full text-left px-3 py-2 text-sm hover:bg-muted"
                          onClick={() => { setClientId(c.id); setCompanySearch(c.company_name); }}
                        >
                          {c.company_name} <span className="text-muted-foreground">— {c.cnpj}</span>
                        </button>
                      ))
                    ) : (
                      <p className="px-3 py-2 text-sm text-muted-foreground">Nenhum cliente encontrado.</p>
                    )}
                    <button
                      type="button"
                      className="w-full flex items-center gap-2 text-left px-3 py-2 text-sm text-primary hover:bg-muted"
                      onClick={openCreateClient}
                    >
                      <UserPlus className="h-4 w-4" /> Cadastrar novo cliente "{companySearch}"
                    </button>
                  </div>
                )}

                {clientId && <p className="text-xs text-success">Cliente selecionado.</p>}
              </>
            ) : (
              <div className="border border-border rounded-lg p-3 space-y-2.5 bg-muted/30">
                <div className="space-y-1.5">
                  <Label className="text-xs">Razão social</Label>
                  <Input value={newClientName} onChange={(e) => setNewClientName(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">CNPJ (somente números)</Label>
                  <Input
                    value={newClientCnpj}
                    onChange={(e) => setNewClientCnpj(e.target.value.replace(/\D/g, ""))}
                    placeholder="00000000000000"
                    maxLength={14}
                  />
                </div>
                <div className="flex justify-between pt-1">
                  <Button type="button" variant="outline" size="sm" onClick={() => setCreatingClient(false)}>
                    <ArrowLeft className="h-4 w-4" /> Voltar à busca
                  </Button>
                  <Button
                    type="button" size="sm"
                    onClick={() => createClientMutation.mutate()}
                    disabled={createClientMutation.isPending}
                  >
                    {createClientMutation.isPending ? "Cadastrando…" : "Cadastrar cliente"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Período inicial</Label>
              <Input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Período final</Label>
              <Input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Regime tributário</Label>
              <Select value={taxRegime} onValueChange={(v) => setTaxRegime(v as TaxRegime)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {TAX_REGIME_OPTIONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Segmento</Label>
              <Input value={segment} onChange={(e) => setSegment(e.target.value)} />
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>

      <IdentificationImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onApply={(data) => {
          if (data.job_number) setJobNumber(data.job_number);
          if (data.company_name) { setCompanySearch(data.company_name); setClientId(""); }
          if (data.segment) setSegment(data.segment);
          if (data.tax_regime) setTaxRegime(data.tax_regime);
        }}
      />
    </Dialog>
  );
}