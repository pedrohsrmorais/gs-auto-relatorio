//routes/admin/pontos.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Pencil, Check, X, AlertCircle, UploadCloud, Trash2, ShieldAlert, Star, Loader2 } from "lucide-react";
import { creditPointDefinitionsApi } from "@/lib/api";
import type { PointDefinition, TaxCode } from "@/lib/api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { DefinitionsImportWizard } from "@/components/data-import/ImportWizards";

// ─── Route ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/admin/pontos")({
  component: () => (
    <ProtectedRoute requireAdmin>
      <PointDefinitionsPage />
    </ProtectedRoute>
  ),
});

const TAX_OPTIONS: { value: TaxCode; label: string }[] = [
  { value: "PIS_COFINS", label: "PIS/COFINS" },
  { value: "IRPJ_CSLL", label: "IRPJ/CSLL" },
  { value: "IPI", label: "IPI" },
  { value: "INSS", label: "INSS" },
  { value: "ICMS", label: "ICMS" },
];

// ─── Badges ───────────────────────────────────────────────────────────────────

function RiskColorBadge({ color }: { color: PointDefinition["risk_color"] }) {
  if (!color) return null;
  const variant = color === "VERDE" ? "success" : color === "AMARELO" ? "warning" : "destructive";
  return <Badge variant={variant} className="text-xs shrink-0">{color}</Badge>;
}

function TaxBadge({ taxName, taxCode }: { taxName: string | null; taxCode: TaxCode | null }) {
  if (!taxCode) {
    return (
      <Badge variant="muted" className="text-xs shrink-0 flex items-center gap-1">
        <AlertCircle className="h-3 w-3" /> sem tributo
      </Badge>
    );
  }
  return <Badge variant="outline" className="text-xs shrink-0">{taxName ?? taxCode}</Badge>;
}

function NatureBadge({ nature }: { nature: PointDefinition["nature"] }) {
  if (nature === "PASSIVO") {
    return <Badge variant="warning" className="text-xs shrink-0">Passivo</Badge>;
  }
  return null; // CREDITO é o padrão, não precisa poluir a linha com badge
}

// ─── Nome editável inline ─────────────────────────────────────────────────────

function EditableName({ point }: { point: PointDefinition }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(point.name ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(point.name ?? "");
  }, [point.name, editing]);

  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const mutation = useMutation({
    mutationFn: () => creditPointDefinitionsApi.updateName(point.id, draft),
    onSuccess: (updated) => {
      toast.success(`Nome salvo: "${updated.name}"`);
      queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
      setEditing(false);
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar nome.");
    },
  });

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") mutation.mutate();
    if (e.key === "Escape") {
      setDraft(point.name ?? "");
      setEditing(false);
    }
  }

  function handleCancel() {
    setDraft(point.name ?? "");
    setEditing(false);
  }

  const isEmpty = !point.name || point.name.trim() === "";

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-1 min-w-0">
        <Input
          ref={inputRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Nome do ponto…"
          className="h-8 text-sm"
        />
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-success hover:text-success hover:bg-success/10"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !draft.trim()}
        >
          <Check className="h-4 w-4" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-8 w-8 shrink-0 text-muted-foreground"
          onClick={handleCancel}
          disabled={mutation.isPending}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setEditing(true)}
      className="group flex items-center gap-2 flex-1 min-w-0 text-left"
    >
      {isEmpty ? (
        <span className="flex items-center gap-1.5 text-sm text-amber-600">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="italic">Sem nome — clique para adicionar</span>
        </span>
      ) : (
        <span className="text-sm font-medium truncate">{point.name}</span>
      )}
      <Pencil className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
    </button>
  );
}

// ─── Tributo editável inline (select) ────────────────────────────────────────

function EditableTax({ point }: { point: PointDefinition }) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (taxCode: TaxCode) => creditPointDefinitionsApi.updateTax(point.id, taxCode),
    onSuccess: (updated) => {
      toast.success(`Tributo atualizado para ${updated.tax_name ?? updated.tax_code}.`);
      queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao salvar tributo."),
  });

  return (
    <Select value={point.tax_code ?? undefined} onValueChange={(v) => mutation.mutate(v as TaxCode)}>
      <SelectTrigger className="h-7 w-32 text-xs shrink-0">
        <SelectValue placeholder="Tributo…" />
      </SelectTrigger>
      <SelectContent>
        {TAX_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

// ─── Botão de ponto prioritário (star toggle) ─────────────────────────────────

function AlwaysShowToggle({ point }: { point: PointDefinition }) {
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (always_show: boolean) =>
      creditPointDefinitionsApi.toggleAlwaysShow(point.id, always_show),
    onSuccess: (_, always_show) => {
      toast.success(
        always_show
          ? `"${point.name || `ID ${point.external_id}`}" marcado como prioritário.`
          : `"${point.name || `ID ${point.external_id}`}" removido dos prioritários.`
      );
      queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
    },
    onError: (err) =>
      toast.error(err instanceof Error ? err.message : "Erro ao atualizar ponto prioritário."),
  });

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          onClick={() => mutation.mutate(!point.always_show)}
          disabled={mutation.isPending}
          className={`h-8 w-8 shrink-0 flex items-center justify-center rounded transition-colors ${
            point.always_show
              ? "text-amber-500 hover:text-amber-600 hover:bg-amber-50"
              : "text-muted-foreground/40 hover:text-amber-400 hover:bg-amber-50"
          }`}
          aria-label={point.always_show ? "Remover prioridade" : "Marcar como prioritário"}
        >
          {mutation.isPending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Star
              className={`h-4 w-4 transition-all ${point.always_show ? "fill-current" : ""}`}
            />
          )}
        </button>
      </TooltipTrigger>
      <TooltipContent side="left" className="max-w-[200px] text-xs">
        {point.always_show
          ? "Ponto prioritário — aparece sempre no diagnóstico mesmo sem dados importados. Clique para remover."
          : "Marcar como prioritário — o ponto sempre aparecerá no diagnóstico, mesmo sem dados importados."}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── Linha ────────────────────────────────────────────────────────────────────

function PointRow({ point, onRequestDelete }: { point: PointDefinition; onRequestDelete: (p: PointDefinition) => void }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-border last:border-0">
      <span className="text-xs font-mono text-muted-foreground bg-muted/50 px-2 py-0.5 rounded shrink-0 w-20 text-center">
        ID {point.external_id}
      </span>
      <Badge
        variant={point.category === "ADM" ? "secondary" : "outline"}
        className="shrink-0 text-xs"
      >
        {point.category}
      </Badge>
      <EditableTax point={point} />
      <NatureBadge nature={point.nature} />
      {point.category === "FTX" && <RiskColorBadge color={point.risk_color} />}
      <EditableName point={point} />
      <AlwaysShowToggle point={point} />
      <Button
        size="icon" variant="ghost"
        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
        onClick={() => onRequestDelete(point)}
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

function PointDefinitionsPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [taxFilter, setTaxFilter] = useState<string>("all");
  const [showOnlyFixed, setShowOnlyFixed] = useState(false);
  const [importCategory, setImportCategory] = useState<"ADM" | "FTX" | null>(null);
  const [importTax, setImportTax] = useState<TaxCode>("PIS_COFINS");
  const [deleteTarget, setDeleteTarget] = useState<PointDefinition | null>(null);
  const [resetAllOpen, setResetAllOpen] = useState(false);
  const [resetAllConfirmText, setResetAllConfirmText] = useState("");
  const queryClient = useQueryClient();

  const { data = [], isLoading } = useQuery({
    queryKey: ["point-definitions", search, categoryFilter, taxFilter, showOnlyFixed],
    queryFn: () =>
      creditPointDefinitionsApi.list({
        search: search || undefined,
        category: categoryFilter !== "all" ? (categoryFilter as "ADM" | "FTX") : undefined,
        tax: taxFilter !== "all" ? (taxFilter as TaxCode) : undefined,
        always_show: showOnlyFixed ? true : undefined,
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => creditPointDefinitionsApi.remove(id),
    onSuccess: () => {
      toast.success("Ponto excluído.");
      queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao excluir ponto."),
  });

  const resetAllMutation = useMutation({
    mutationFn: () => creditPointDefinitionsApi.resetAll(),
    onSuccess: (res) => {
      const totalPoints = res.deleted.credit_point_definitions ?? 0;
      toast.success(`Tudo zerado: ${totalPoints} ponto(s) e todos os valores importados em jobs foram removidos.`);
      queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
      setResetAllOpen(false);
      setResetAllConfirmText("");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao zerar os pontos."),
  });

  const unnamed = data.filter((p) => !p.name || p.name.trim() === "");
  const named   = data.filter((p) => p.name && p.name.trim() !== "");
  const fixedCount = data.filter((p) => p.always_show).length;

  function openImport(category: "ADM" | "FTX", tax: TaxCode) {
    setImportCategory(category);
    setImportTax(tax);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-display font-semibold">Pontos</h1>
          <p className="text-sm text-muted-foreground">
            Catálogo global de pontos ADM e FTX, com o tributo (PIS/COFINS, IPI, IRPJ/CSLL, INSS, ICMS) de cada
            um. Importe a tabela mestre para popular nome, cor e tributo de uma vez, ou edite ponto a ponto
            clicando na linha. Use a estrela (⭐) para marcar pontos prioritários — eles aparecem sempre no
            diagnóstico, mesmo sem dados importados.
          </p>
        </div>
        <div className="flex gap-2 shrink-0 flex-wrap">
          <Button variant="outline" size="sm" onClick={() => openImport("ADM", "PIS_COFINS")}>
            <UploadCloud className="h-4 w-4" /> Importar Pontos ADM (PRT)
          </Button>
          <Button variant="outline" size="sm" onClick={() => openImport("FTX", "PIS_COFINS")}>
            <UploadCloud className="h-4 w-4" /> Importar Pontos FTX (Fintax)
          </Button>
          <Button
            variant="outline" size="sm"
            className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setResetAllOpen(true)}
          >
            <ShieldAlert className="h-4 w-4" /> Excluir todos os pontos
          </Button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Buscar por ID ou nome…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as categorias</SelectItem>
            <SelectItem value="ADM">ADM</SelectItem>
            <SelectItem value="FTX">FTX</SelectItem>
          </SelectContent>
        </Select>
        <Select value={taxFilter} onValueChange={setTaxFilter}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os tributos</SelectItem>
            {TAX_OPTIONS.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
          </SelectContent>
        </Select>
        {/* Filtro "Apenas prioritários" */}
        <Button
          variant={showOnlyFixed ? "default" : "outline"}
          size="sm"
          onClick={() => setShowOnlyFixed((v) => !v)}
          className={showOnlyFixed ? "gap-1.5" : "gap-1.5 text-muted-foreground"}
        >
          <Star className={`h-4 w-4 ${showOnlyFixed ? "fill-current" : ""}`} />
          Prioritários
        </Button>
      </div>

      {!isLoading && data.length > 0 && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {data.length} ponto{data.length !== 1 ? "s" : ""} encontrado{data.length !== 1 ? "s" : ""}
          </span>
          {fixedCount > 0 && !showOnlyFixed && (
            <>
              <span>·</span>
              <span className="text-amber-600 font-medium flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-current" />
                {fixedCount} prioritário{fixedCount !== 1 ? "s" : ""}
              </span>
            </>
          )}
          {unnamed.length > 0 && (
            <>
              <span>·</span>
              <span className="text-amber-600 font-medium flex items-center gap-1">
                <AlertCircle className="h-3.5 w-3.5" />
                {unnamed.length} sem nome
              </span>
            </>
          )}
        </div>
      )}

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      {!isLoading && data.length === 0 && (
        <Card className="p-10 text-center">
          <p className="text-sm text-muted-foreground">
            {showOnlyFixed
              ? "Nenhum ponto prioritário encontrado. Clique na estrela ao lado de um ponto para marcá-lo."
              : "Nenhum ponto encontrado. Importe a tabela mestre acima, ou importe dados na aba Coleta de Dados de um job para criar definições automaticamente."}
          </p>
        </Card>
      )}

      {unnamed.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-amber-600 uppercase tracking-wide">
            Aguardando nome ({unnamed.length})
          </p>
          <Card className="overflow-hidden">
            {unnamed.map((p) => <PointRow key={p.id} point={p} onRequestDelete={setDeleteTarget} />)}
          </Card>
        </div>
      )}

      {named.length > 0 && (
        <div className="space-y-1.5">
          {unnamed.length > 0 && (
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Nomeados ({named.length})
            </p>
          )}
          <Card className="overflow-hidden">
            {named.map((p) => <PointRow key={p.id} point={p} onRequestDelete={setDeleteTarget} />)}
          </Card>
        </div>
      )}

      {importCategory && (
        <DefinitionsImportWizard
          open={!!importCategory}
          onOpenChange={(open) => !open && setImportCategory(null)}
          category={importCategory}
          taxCode={importTax}
          onImported={() => queryClient.invalidateQueries({ queryKey: ["point-definitions"] })}
        />
      )}

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir ponto "{deleteTarget?.name || `ID ${deleteTarget?.external_id}`}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Se este ponto já tiver valores importados em algum job, a exclusão será bloqueada
            — nesse caso, desimporte os valores no job primeiro.
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

      <Dialog open={resetAllOpen} onOpenChange={(open) => { if (!open) { setResetAllOpen(false); setResetAllConfirmText(""); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-destructive">
              <ShieldAlert className="h-5 w-5" /> Excluir TODOS os pontos?
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Isso apaga <strong>todo o catálogo global de pontos</strong> ({data.length} ponto(s) na tela atual,
              mas a exclusão vale para todos, independente do filtro) <strong>e também todos os valores já
              importados em qualquer job</strong> — Pontos ADM, FTX, IPI e IR/CSLL, além das observações de
              diagnóstico. Isso afeta todos os jobs da plataforma, não só um.
            </p>
            <p className="font-medium text-destructive">Esta ação não pode ser desfeita.</p>
            <div className="space-y-1.5">
              <label className="text-xs font-medium">
                Digite <span className="font-mono bg-muted px-1 rounded">EXCLUIR TUDO</span> para confirmar
              </label>
              <Input
                value={resetAllConfirmText}
                onChange={(e) => setResetAllConfirmText(e.target.value)}
                placeholder="EXCLUIR TUDO"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => { setResetAllOpen(false); setResetAllConfirmText(""); }}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => resetAllMutation.mutate()}
              disabled={resetAllConfirmText !== "EXCLUIR TUDO" || resetAllMutation.isPending}
            >
              {resetAllMutation.isPending ? "Excluindo…" : "Sim, excluir tudo"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}