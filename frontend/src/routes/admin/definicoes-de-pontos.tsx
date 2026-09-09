import { createFileRoute } from "@tanstack/react-router";
import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search, Pencil, Check, X, AlertCircle } from "lucide-react";
import { creditPointDefinitionsApi } from "@/lib/api";
import type { PointDefinition } from "@/lib/api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

// ─── Route ───────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/admin/definicoes-de-pontos")({
  component: () => (
    <ProtectedRoute requireAdmin>
      <PointDefinitionsPage />
    </ProtectedRoute>
  ),
});

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

// ─── Linha ────────────────────────────────────────────────────────────────────

function PointRow({ point }: { point: PointDefinition }) {
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
      <EditableName point={point} />
    </div>
  );
}

// ─── Página ───────────────────────────────────────────────────────────────────

function PointDefinitionsPage() {
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  const { data = [], isLoading } = useQuery({
    queryKey: ["point-definitions", search, categoryFilter],
    queryFn: () =>
      creditPointDefinitionsApi.list({
        search: search || undefined,
        category: categoryFilter !== "all" ? (categoryFilter as "ADM" | "FTX") : undefined,
      }),
  });

  const unnamed = data.filter((p) => !p.name || p.name.trim() === "");
  const named   = data.filter((p) => p.name && p.name.trim() !== "");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-display font-semibold">Definições de pontos</h1>
        <p className="text-sm text-muted-foreground">
          Pontos importados via planilha. Clique em qualquer linha para editar o nome.
        </p>
      </div>

      <div className="flex gap-3">
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
      </div>

      {!isLoading && data.length > 0 && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground">
          <span>
            {data.length} ponto{data.length !== 1 ? "s" : ""} encontrado{data.length !== 1 ? "s" : ""}
          </span>
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
            Nenhum ponto encontrado. Importe dados na aba{" "}
            <strong>Coleta</strong> de um job para criar definições.
          </p>
        </Card>
      )}

      {unnamed.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-amber-600 uppercase tracking-wide">
            Aguardando nome ({unnamed.length})
          </p>
          <Card className="overflow-hidden">
            {unnamed.map((p) => <PointRow key={p.id} point={p} />)}
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
            {named.map((p) => <PointRow key={p.id} point={p} />)}
          </Card>
        </div>
      )}
    </div>
  );
}