import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Building2, Trash2 } from "lucide-react";
import { clientsApi } from "@/lib/api";
import type { Client, TaxRegime } from "@/lib/types";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export const Route = createFileRoute("/clientes")({
  component: () => (
    <ProtectedRoute>
      <ClientesPage />
    </ProtectedRoute>
  ),
});

const TAX_REGIME_OPTIONS: TaxRegime[] = ["Lucro Real", "Lucro Presumido", "Simples Nacional", "Lucro Arbitrado"];

function formatCnpj(cnpj: string) {
  const d = cnpj.replace(/\D/g, "").padStart(14, "0");
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12, 14)}`;
}

function NewClientDialog() {
  const [open, setOpen] = useState(false);
  const [cnpj, setCnpj] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [segment, setSegment] = useState("");
  const [taxRegime, setTaxRegime] = useState<TaxRegime | "">("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => {
      if (!cnpj.trim() || !companyName.trim()) throw new Error("Informe CNPJ e razão social.");
      return clientsApi.create({
        cnpj, company_name: companyName,
        segment: segment || undefined,
        tax_regime: taxRegime || undefined,
      });
    },
    onSuccess: () => {
      toast.success("Cliente cadastrado.");
      queryClient.invalidateQueries({ queryKey: ["clients-list"] });
      setOpen(false);
      setCnpj(""); setCompanyName(""); setSegment(""); setTaxRegime("");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao cadastrar cliente."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4" /> Novo cliente</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo cliente</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Razão social</Label>
            <Input value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">CNPJ (somente números)</Label>
            <Input
              value={cnpj}
              onChange={(e) => setCnpj(e.target.value.replace(/\D/g, ""))}
              placeholder="00000000000000"
              maxLength={14}
            />
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
            {mutation.isPending ? "Cadastrando…" : "Cadastrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientesPage() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<Client | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["clients-list", search],
    queryFn: () => clientsApi.list({ search: search || undefined, limit: 100 }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => clientsApi.remove(id),
    onSuccess: () => {
      toast.success("Cliente excluído.");
      queryClient.invalidateQueries({ queryKey: ["clients-list"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao excluir cliente."),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Clientes</h1>
          <p className="text-sm text-muted-foreground">
            Todos os clientes cadastrados na plataforma (via criação de Job ou diretamente aqui).
          </p>
        </div>
        <NewClientDialog />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome ou CNPJ…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Carregando…</p>
      ) : (
        <div className="grid gap-2">
          {data?.data.map((c) => (
            <Card key={c.id} className="p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
                <div className="min-w-0">
                  <p className="font-medium truncate">{c.company_name}</p>
                  <p className="text-sm text-muted-foreground">{formatCnpj(c.cnpj)}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {c.tax_regime && <Badge variant="secondary">{c.tax_regime}</Badge>}
                {c.segment && <Badge variant="outline">{c.segment}</Badge>}
                {isAdmin && (
                  <Button
                    variant="ghost" size="icon"
                    className="text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                    onClick={() => setDeleteTarget(c)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </Card>
          ))}
          {data?.data.length === 0 && (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhum cliente encontrado.</p>
          )}
        </div>
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir "{deleteTarget?.company_name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se este cliente tiver algum job vinculado, a exclusão será bloqueada — exclua os jobs primeiro.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Excluindo…" : "Sim, excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}