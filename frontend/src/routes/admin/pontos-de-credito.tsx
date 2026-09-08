import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, Pencil, Archive } from "lucide-react";
import { taxesApi, creditPointsApi } from "@/lib/api";
import type { CreditCategory, CreditPoint, RiskColor } from "@/lib/types";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export const Route = createFileRoute("/admin/pontos-de-credito")({
  component: () => (
    <ProtectedRoute requireAdmin>
      <CreditPointsAdminPage />
    </ProtectedRoute>
  ),
});

const RISK_COLORS: RiskColor[] = ["VERDE", "AMARELO", "VERMELHO"];

function CreditPointFormDialog({
  editing, onClose,
}: {
  editing: CreditPoint | "new" | null;
  onClose: () => void;
}) {
  const { data: taxes = [] } = useQuery({ queryKey: ["taxes"], queryFn: taxesApi.list });
  const queryClient = useQueryClient();

  const isEditing = editing && editing !== "new";
  const [taxId, setTaxId] = useState<number | "">(isEditing ? editing.tax_id : "");
  const [name, setName] = useState(isEditing ? editing.name : "");
  const [category, setCategory] = useState<CreditCategory>(isEditing ? editing.category : "ADM");
  const [riskColor, setRiskColor] = useState<RiskColor | "">(isEditing ? editing.risk_color ?? "" : "");
  const [legalCriteria, setLegalCriteria] = useState(isEditing ? editing.legal_criteria ?? "" : "");

  const mutation = useMutation({
    mutationFn: () => {
      const payload = {
        name, category,
        risk_color: category === "FINTAX" ? (riskColor || undefined) : undefined,
        legal_criteria: legalCriteria || undefined,
      };
      if (isEditing) return creditPointsApi.update(editing.id, payload);
      if (!taxId) throw new Error("Selecione o tributo.");
      return creditPointsApi.create({ ...payload, tax_id: taxId });
    },
    onSuccess: () => {
      toast.success(isEditing ? "Ponto atualizado." : "Ponto criado.");
      queryClient.invalidateQueries({ queryKey: ["credit-points"] });
      onClose();
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar."),
  });

  return (
    <Dialog open={!!editing} onOpenChange={(v) => !v && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>{isEditing ? "Editar ponto de crédito" : "Novo ponto de crédito"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Tributo</Label>
              <Select value={String(taxId)} onValueChange={(v) => setTaxId(Number(v))} disabled={!!isEditing}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {taxes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Categoria</Label>
              <Select value={category} onValueChange={(v) => setCategory(v as CreditCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ADM">ADM</SelectItem>
                  <SelectItem value="FINTAX">FINTAX</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {category === "FINTAX" && (
            <div className="space-y-1.5">
              <Label className="text-xs">Cor de risco</Label>
              <Select value={riskColor} onValueChange={(v) => setRiskColor(v as RiskColor)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {RISK_COLORS.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="space-y-1.5">
            <Label className="text-xs">Nome do ponto</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Critério legal</Label>
            <Textarea value={legalCriteria} onChange={(e) => setLegalCriteria(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Salvando…" : "Salvar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreditPointsAdminPage() {
  const [search, setSearch] = useState("");
  const [taxFilter, setTaxFilter] = useState<string>("all");
  const [editing, setEditing] = useState<CreditPoint | "new" | null>(null);
  const queryClient = useQueryClient();

  const { data: taxes = [] } = useQuery({ queryKey: ["taxes"], queryFn: taxesApi.list });
  const { data, isLoading } = useQuery({
    queryKey: ["credit-points", search, taxFilter],
    queryFn: () => creditPointsApi.list({
      search: search || undefined,
      tax_id: taxFilter !== "all" ? Number(taxFilter) : undefined,
      limit: 100,
    }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: number) => creditPointsApi.deactivate(id),
    onSuccess: () => { toast.success("Ponto desativado."); queryClient.invalidateQueries({ queryKey: ["credit-points"] }); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao desativar."),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Pontos de crédito</h1>
          <p className="text-sm text-muted-foreground">Catálogo usado no wizard de revisão dos Jobs.</p>
        </div>
        <Button onClick={() => setEditing("new")}><Plus className="h-4 w-4" /> Novo ponto</Button>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={taxFilter} onValueChange={setTaxFilter}>
          <SelectTrigger className="w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tributos</SelectItem>
            {taxes.map((t) => <SelectItem key={t.id} value={String(t.id)}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      <div className="grid gap-2">
        {data?.data.map((cp) => (
          <Card key={cp.id} className="p-4 flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <p className="font-medium truncate">{cp.name}</p>
                <Badge variant="secondary">{cp.tax_name}</Badge>
                <Badge variant="outline">{cp.category}</Badge>
                {cp.risk_color && (
                  <Badge variant={cp.risk_color === "VERDE" ? "success" : cp.risk_color === "AMARELO" ? "warning" : "destructive"}>
                    {cp.risk_color}
                  </Badge>
                )}
                {!cp.is_active && <Badge variant="destructive">Inativo</Badge>}
              </div>
              {cp.legal_criteria && <p className="text-sm text-muted-foreground truncate mt-0.5">{cp.legal_criteria}</p>}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button variant="outline" size="sm" onClick={() => setEditing(cp)}>
                <Pencil className="h-4 w-4" /> Editar
              </Button>
              {cp.is_active && (
                <Button variant="ghost" size="sm" onClick={() => deactivateMutation.mutate(cp.id)}>
                  <Archive className="h-4 w-4" /> Desativar
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <CreditPointFormDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}
