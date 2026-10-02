// src/components/data-import/ManualEntryModal.tsx
//
// Modais de entrada manual de dados (estilo planilha) para todos os tipos de
// pontos de crédito. Exporta 4 componentes independentes:
//
//   PontoManualEntryModal  → PIS/COFINS ADM e FTX (grade com 5 colunas)
//   IpiManualEntryModal    → IPI (seleciona ponto do catálogo + grade mês/valor)
//   IrCsllManualEntryModal → IR/CSLL (grade + etapa de match de pontos, 2 passos)
//   InssManualEntryModal   → INSS   (grade + etapa de match de pontos, 2 passos)
//
// Nenhum desses componentes depende de PointMatchPicker de IpiIrCsllWizards —
// toda a lógica de busca e match é reimplementada aqui de forma simplificada.

import { useState, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Plus, Trash2, CheckCircle2, Loader2, AlertTriangle, ArrowLeft,
  ArrowRight, Check, Search,
} from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { creditPointDefinitionsApi } from "@/lib/api";
import type { PointDefinition } from "@/lib/api";
import type { ParsedPontoMonthlyRow, ParsedIpiMonthlyRow } from "@/lib/import/customParsers";
import type { IrCsllResolvedRow, InssResolvedRow } from "@/components/data-import/IpiIrCsllWizards";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function uid(): string {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Aceita "1.234,56" (BR) e "1234.56" (EN). */
function parseValue(s: string): number {
  const cleaned = s.trim().replace(/\./g, "").replace(",", ".");
  return parseFloat(cleaned);
}

function normalizeStr(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isValidMonth(s: string): boolean {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(s.trim());
}

function isValidYear(s: string): boolean {
  return /^\d{4}$/.test(s.trim());
}

// ─── PointMatch type (local, equivalente ao de IpiIrCsllWizards) ──────────────

type PointMatch =
  | { mode: "existing"; pointId: number }
  | { mode: "new"; name: string; category: "ADM" | "FTX" }
  | { mode: "unresolved" };

function computeAutoMatch(candidates: PointDefinition[], targetName: string): PointMatch {
  const norm = normalizeStr(targetName);
  const exact = candidates.filter((c) => normalizeStr(c.name) === norm);
  if (exact.length === 1) return { mode: "existing", pointId: exact[0].id };
  return { mode: "unresolved" };
}

// ─── InlinePointPicker ────────────────────────────────────────────────────────
//
// Usado no passo de match dos wizards de IR/CSLL e INSS e como seletor de
// ponto único no IpiManualEntryModal.

function InlinePointPicker({
  candidates,
  value,
  onChange,
  defaultNewName,
  taxLabel,
}: {
  candidates: PointDefinition[];
  value: PointMatch;
  onChange: (v: PointMatch) => void;
  defaultNewName: string;
  taxLabel: string;
}) {
  const [searching, setSearching] = useState(value.mode === "unresolved");
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState(defaultNewName);
  const [newCategory, setNewCategory] = useState<"ADM" | "FTX">("ADM");

  useEffect(() => {
    if (value.mode === "unresolved") setSearching(true);
  }, [value.mode]);

  const filtered = search.trim()
    ? candidates.filter(
        (c) =>
          normalizeStr(c.name).includes(normalizeStr(search)) ||
          c.external_id.includes(search.trim()),
      )
    : candidates;

  if (value.mode === "existing" && !searching) {
    const pt = candidates.find((c) => c.id === value.pointId);
    return (
      <div className="flex items-center gap-2 text-sm min-w-0">
        <Badge variant="success" className="shrink-0 gap-1">
          <Check className="h-3 w-3" /> ID {pt?.external_id ?? value.pointId}
        </Badge>
        {pt && (
          <Badge
            variant={pt.category === "ADM" ? "secondary" : "outline"}
            className="shrink-0 text-xs"
          >
            {pt.category}
          </Badge>
        )}
        <span className="truncate">{pt?.name ?? `Ponto #${value.pointId}`}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs shrink-0"
          onClick={() => setSearching(true)}
        >
          Trocar
        </Button>
      </div>
    );
  }

  if (value.mode === "new" && !searching) {
    return (
      <div className="flex items-center gap-2 text-sm min-w-0">
        <Badge variant="warning" className="shrink-0">Ponto novo</Badge>
        <Badge
          variant={value.category === "ADM" ? "secondary" : "outline"}
          className="shrink-0 text-xs"
        >
          {value.category}
        </Badge>
        <span className="truncate">{value.name}</span>
        <Button
          size="sm"
          variant="ghost"
          className="h-6 px-2 text-xs shrink-0"
          onClick={() => setSearching(true)}
        >
          Trocar
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 w-full">
      {value.mode === "unresolved" && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" />
          Não encontrado no catálogo — busque ou crie um novo ponto.
        </p>
      )}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar por nome ou ID…"
            className="h-8 text-sm pl-7"
          />
        </div>
        {value.mode !== "unresolved" && (
          <Button
            size="sm"
            variant="ghost"
            className="h-8 px-2 text-xs shrink-0"
            onClick={() => setSearching(false)}
          >
            Cancelar
          </Button>
        )}
      </div>
      <div className="max-h-36 overflow-auto border border-border rounded-md divide-y divide-border">
        {filtered.slice(0, 30).map((c) => (
          <button
            key={c.id}
            type="button"
            className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
            onClick={() => {
              onChange({ mode: "existing", pointId: c.id });
              setSearching(false);
            }}
          >
            <span className="font-mono text-xs bg-muted px-1 rounded shrink-0">
              ID {c.external_id}
            </span>
            <Badge
              variant={c.category === "ADM" ? "secondary" : "outline"}
              className="shrink-0 text-xs"
            >
              {c.category}
            </Badge>
            <span className="truncate">{c.name}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            Nenhum ponto encontrado no catálogo de {taxLabel}.
          </p>
        )}
      </div>
      <div className="space-y-1.5 border-t border-border pt-1.5">
        <div className="flex items-center gap-2">
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-8 text-sm flex-1"
            placeholder="Nome do novo ponto"
          />
          <div className="flex items-center gap-1 shrink-0 bg-muted rounded-md p-0.5">
            {(["ADM", "FTX"] as const).map((cat) => (
              <button
                key={cat}
                type="button"
                onClick={() => setNewCategory(cat)}
                className={`px-2 py-1 rounded text-xs font-medium transition-colors ${
                  newCategory === cat ? "bg-card shadow-sm" : "text-muted-foreground"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="h-8 text-xs w-full"
          disabled={!newName.trim() && !defaultNewName.trim()}
          onClick={() => {
            onChange({
              mode: "new",
              name: newName.trim() || defaultNewName,
              category: newCategory,
            });
            setSearching(false);
          }}
        >
          Criar novo ponto {taxLabel} — {newCategory}
        </Button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// PontoManualEntryModal — PIS/COFINS ADM e FTX
// ═════════════════════════════════════════════════════════════════════════════

interface PontoRow {
  id: string;
  external_point_id: string;
  point_name: string;
  reference_month: string; // AAAA-MM
  contribution: "PIS" | "COFINS" | "";
  value: string;
}

function newPontoRow(): PontoRow {
  return {
    id: uid(),
    external_point_id: "",
    point_name: "",
    reference_month: "",
    contribution: "",
    value: "",
  };
}

function isPontoRowValid(r: PontoRow): boolean {
  return (
    isValidMonth(r.reference_month) &&
    (r.contribution === "PIS" || r.contribution === "COFINS") &&
    !isNaN(parseValue(r.value))
  );
}

export function PontoManualEntryModal({
  open,
  onOpenChange,
  title,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  onCommit: (rows: ParsedPontoMonthlyRow[]) => Promise<{ inserted: number; pointName: string }>;
}) {
  const [rows, setRows] = useState<PontoRow[]>([newPontoRow()]);
  const [committing, setCommitting] = useState(false);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);

  function reset() {
    setRows([newPontoRow()]);
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  function addRow() {
    setRows((r) => [...r, newPontoRow()]);
    // scroll para o fim após render
    setTimeout(() => {
      tbodyRef.current?.lastElementChild?.scrollIntoView({ block: "nearest" });
    }, 50);
  }

  function removeRow(id: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.id !== id) : r));
  }

  function updateRow(id: string, field: keyof PontoRow, val: string) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
  }

  /** Ao colar (Ctrl+V) em qualquer célula da grade, tenta parsear como TSV. */
  function handlePaste(e: React.ClipboardEvent<HTMLTableSectionElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return; // não parece grade
    e.preventDefault();

    const newRows: PontoRow[] = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const [extId = "", name = "", month = "", contrib = "", val = ""] = line.split("\t");
        const row = newPontoRow();
        row.external_point_id = extId.trim();
        row.point_name = name.trim();
        row.reference_month = month.trim();
        row.contribution =
          contrib.trim().toUpperCase() === "PIS"
            ? "PIS"
            : contrib.trim().toUpperCase() === "COFINS"
            ? "COFINS"
            : "";
        row.value = val.trim();
        return row;
      });

    if (newRows.length > 0) {
      setRows((prev) => {
        // substitui primeira linha em branco, senão acrescenta
        const hasBlank = prev.length === 1 && !isPontoRowValid(prev[0]);
        return hasBlank ? newRows : [...prev, ...newRows];
      });
    }
  }

  const validCount = rows.filter(isPontoRowValid).length;

  async function handleCommit() {
    const valid: ParsedPontoMonthlyRow[] = rows
      .filter(isPontoRowValid)
      .map((r) => ({
        contribution: r.contribution as "PIS" | "COFINS",
        reference_month: r.reference_month.trim(),
        value: parseValue(r.value),
        ...(r.external_point_id.trim() ? { external_point_id: r.external_point_id.trim() } : {}),
        ...(r.point_name.trim() ? { point_name: r.point_name.trim() } : {}),
      }));

    if (valid.length === 0) {
      toast.error("Nenhuma linha válida para importar. Verifique Mês (AAAA-MM), Tributo e Valor.");
      return;
    }

    setCommitting(true);
    try {
      const res = await onCommit(valid);
      toast.success(`${res.inserted} valor(es) importado(s).`);
      handleClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar dados.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Inserir {title} manualmente</DialogTitle>
        </DialogHeader>

        <p className="text-sm text-muted-foreground">
          Preencha as linhas como em uma planilha. Você também pode{" "}
          <strong>colar dados copiados do Excel</strong> (colunas: ID_PONTO, Nome, Mês, Tributo,
          Valor). Campos obrigatórios: Mês (AAAA-MM), Tributo e Valor.
        </p>

        <div className="flex-1 overflow-auto border border-border rounded-lg min-h-0">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/60 border-b border-border sticky top-0 z-10">
              <tr>
                <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-28">
                  ID_PONTO
                </th>
                <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground">
                  Nome do ponto
                </th>
                <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-28">
                  Mês <span className="text-destructive">*</span>
                </th>
                <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-28">
                  Tributo <span className="text-destructive">*</span>
                </th>
                <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-32">
                  Valor <span className="text-destructive">*</span>
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody ref={tbodyRef} className="divide-y divide-border" onPaste={handlePaste}>
              {rows.map((row) => {
                const valid = isPontoRowValid(row);
                const hasAnyData =
                  row.external_point_id || row.point_name || row.reference_month || row.contribution || row.value;
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-muted/20 ${hasAnyData && !valid ? "bg-destructive/5" : ""}`}
                  >
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 text-xs font-mono"
                        value={row.external_point_id}
                        onChange={(e) => updateRow(row.id, "external_point_id", e.target.value)}
                        placeholder="ex: 001"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className="h-8 text-xs"
                        value={row.point_name}
                        onChange={(e) => updateRow(row.id, "point_name", e.target.value)}
                        placeholder="Nome do ponto"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className={`h-8 text-xs font-mono ${
                          row.reference_month && !isValidMonth(row.reference_month)
                            ? "border-destructive"
                            : ""
                        }`}
                        value={row.reference_month}
                        onChange={(e) => updateRow(row.id, "reference_month", e.target.value)}
                        placeholder="2023-01"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Select
                        value={row.contribution}
                        onValueChange={(v) => updateRow(row.id, "contribution", v)}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="PIS">PIS</SelectItem>
                          <SelectItem value="COFINS">COFINS</SelectItem>
                        </SelectContent>
                      </Select>
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className={`h-8 text-xs text-right ${
                          row.value && isNaN(parseValue(row.value)) ? "border-destructive" : ""
                        }`}
                        value={row.value}
                        onChange={(e) => updateRow(row.id, "value", e.target.value)}
                        placeholder="0,00"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="text-muted-foreground hover:text-destructive p-1 rounded"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-4 w-4" /> Adicionar linha
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">
            {validCount} de {rows.length} linha(s) válida(s)
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancelar
          </Button>
          <Button onClick={handleCommit} disabled={committing || validCount === 0}>
            {committing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Importar {validCount} valor(es)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// IpiManualEntryModal — seleciona o ponto no catálogo + grade mês/valor
// ═════════════════════════════════════════════════════════════════════════════

interface IpiRow {
  id: string;
  reference_month: string; // AAAA-MM
  value: string;
}

function newIpiRow(): IpiRow {
  return { id: uid(), reference_month: "", value: "" };
}

function isIpiRowValid(r: IpiRow): boolean {
  return isValidMonth(r.reference_month) && !isNaN(parseValue(r.value));
}

export function IpiManualEntryModal({
  open,
  onOpenChange,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCommit: (
    pointId: number,
    pointName: string,
    rows: ParsedIpiMonthlyRow[],
  ) => Promise<{ inserted: number; pointName: string }>;
}) {
  const [match, setMatch] = useState<PointMatch>({ mode: "unresolved" });
  const [rows, setRows] = useState<IpiRow[]>([newIpiRow()]);
  const [committing, setCommitting] = useState(false);

  const { data: candidates = [] } = useQuery({
    queryKey: ["point-definitions", "IPI", "CREDITO"],
    queryFn: () => creditPointDefinitionsApi.list({ tax: "IPI", nature: "CREDITO" }),
    enabled: open,
  });

  function reset() {
    setMatch({ mode: "unresolved" });
    setRows([newIpiRow()]);
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  function addRow() {
    setRows((r) => [...r, newIpiRow()]);
  }

  function removeRow(id: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.id !== id) : r));
  }

  function updateRow(id: string, field: keyof IpiRow, val: string) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTableSectionElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();

    const newRows: IpiRow[] = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const [month = "", val = ""] = line.split("\t");
        const row = newIpiRow();
        row.reference_month = month.trim();
        row.value = val.trim();
        return row;
      });

    if (newRows.length > 0) {
      setRows((prev) => {
        const hasBlank = prev.length === 1 && !isIpiRowValid(prev[0]);
        return hasBlank ? newRows : [...prev, ...newRows];
      });
    }
  }

  const validRows = rows.filter(isIpiRowValid);

  async function handleCommit() {
    if (match.mode === "unresolved") {
      toast.error("Selecione ou crie o ponto no catálogo antes de importar.");
      return;
    }
    if (validRows.length === 0) {
      toast.error("Nenhuma linha válida para importar. Verifique Mês (AAAA-MM) e Valor.");
      return;
    }

    setCommitting(true);
    try {
      let pointId: number;
      let pointName: string;

      if (match.mode === "new") {
        const created = await creditPointDefinitionsApi.quickCreate(
          match.category,
          "IPI",
          match.name,
        );
        pointId = created.id;
        pointName = created.name;
      } else {
        pointId = match.pointId;
        pointName = candidates.find((c) => c.id === match.pointId)?.name ?? "";
      }

      const parsed: ParsedIpiMonthlyRow[] = validRows.map((r) => ({
        reference_month: r.reference_month.trim(),
        value: parseValue(r.value),
      }));

      const res = await onCommit(pointId, pointName, parsed);
      toast.success(`${res.inserted} valor(es) importado(s) para "${res.pointName}".`);
      handleClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar dados.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Inserir Pontos IPI manualmente</DialogTitle>
        </DialogHeader>

        {/* Seleção do ponto */}
        <div className="space-y-1.5 rounded-lg border border-border p-3 bg-muted/20">
          <p className="text-xs font-medium text-muted-foreground">Ponto de IPI do catálogo</p>
          <InlinePointPicker
            candidates={candidates}
            value={match}
            onChange={setMatch}
            defaultNewName=""
            taxLabel="IPI"
          />
        </div>

        <p className="text-sm text-muted-foreground">
          Informe um valor mensal por linha. Você também pode{" "}
          <strong>colar do Excel</strong> (colunas: Mês, Valor).
        </p>

        {/* Grade */}
        <div className="flex-1 overflow-auto border border-border rounded-lg min-h-0">
          <table className="w-full text-sm border-collapse">
            <thead className="bg-muted/60 border-b border-border sticky top-0">
              <tr>
                <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground">
                  Mês <span className="text-destructive">*</span>
                </th>
                <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-36">
                  Valor <span className="text-destructive">*</span>
                </th>
                <th className="w-8" />
              </tr>
            </thead>
            <tbody className="divide-y divide-border" onPaste={handlePaste}>
              {rows.map((row) => {
                const hasAnyData = row.reference_month || row.value;
                const valid = isIpiRowValid(row);
                return (
                  <tr
                    key={row.id}
                    className={`hover:bg-muted/20 ${hasAnyData && !valid ? "bg-destructive/5" : ""}`}
                  >
                    <td className="px-1 py-1">
                      <Input
                        className={`h-8 text-xs font-mono ${
                          row.reference_month && !isValidMonth(row.reference_month)
                            ? "border-destructive"
                            : ""
                        }`}
                        value={row.reference_month}
                        onChange={(e) => updateRow(row.id, "reference_month", e.target.value)}
                        placeholder="2023-01"
                      />
                    </td>
                    <td className="px-1 py-1">
                      <Input
                        className={`h-8 text-xs text-right ${
                          row.value && isNaN(parseValue(row.value)) ? "border-destructive" : ""
                        }`}
                        value={row.value}
                        onChange={(e) => updateRow(row.id, "value", e.target.value)}
                        placeholder="0,00"
                      />
                    </td>
                    <td className="px-1 py-1 text-center">
                      {rows.length > 1 && (
                        <button
                          type="button"
                          onClick={() => removeRow(row.id)}
                          className="text-muted-foreground hover:text-destructive p-1 rounded"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-4 w-4" /> Adicionar linha
          </Button>
          <span className="text-xs text-muted-foreground ml-auto">
            {validRows.length} de {rows.length} linha(s) válida(s)
          </span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleClose(false)}>
            Cancelar
          </Button>
          <Button
            onClick={handleCommit}
            disabled={committing || validRows.length === 0 || match.mode === "unresolved"}
          >
            {committing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <CheckCircle2 className="h-4 w-4" />
            )}
            Importar {validRows.length} valor(es)
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// IrCsllManualEntryModal — grade de dados + etapa de match (2 passos)
// ═════════════════════════════════════════════════════════════════════════════

type IrCsllStep = "grid" | "match";

interface IrCsllRow {
  id: string;
  point_name: string;
  reference_year: string;
  tax_sub_type: "IRPJ" | "CSLL" | "";
  value: string;
}

function newIrCsllRow(): IrCsllRow {
  return { id: uid(), point_name: "", reference_year: "", tax_sub_type: "", value: "" };
}

function isIrCsllRowValid(r: IrCsllRow): boolean {
  return (
    r.point_name.trim().length > 0 &&
    isValidYear(r.reference_year) &&
    (r.tax_sub_type === "IRPJ" || r.tax_sub_type === "CSLL") &&
    !isNaN(parseValue(r.value))
  );
}

export function IrCsllManualEntryModal({
  open,
  onOpenChange,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCommit: (rows: IrCsllResolvedRow[]) => Promise<{ inserted: number }>;
}) {
  const [step, setStep] = useState<IrCsllStep>("grid");
  const [rows, setRows] = useState<IrCsllRow[]>([newIrCsllRow()]);
  const [matches, setMatches] = useState<Record<string, PointMatch>>({});
  const [committing, setCommitting] = useState(false);

  const { data: candidates = [] } = useQuery({
    queryKey: ["point-definitions", "IRPJ_CSLL", "CREDITO"],
    queryFn: () => creditPointDefinitionsApi.list({ tax: "IRPJ_CSLL", nature: "CREDITO" }),
    enabled: open,
  });

  function reset() {
    setStep("grid");
    setRows([newIrCsllRow()]);
    setMatches({});
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  function addRow() {
    setRows((r) => [...r, newIrCsllRow()]);
  }

  function removeRow(id: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.id !== id) : r));
  }

  function updateRow(id: string, field: keyof IrCsllRow, val: string) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTableSectionElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();

    const newRows: IrCsllRow[] = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const [name = "", year = "", type = "", val = ""] = line.split("\t");
        const row = newIrCsllRow();
        row.point_name = name.trim();
        row.reference_year = year.trim();
        const t = type.trim().toUpperCase();
        row.tax_sub_type = t === "IRPJ" ? "IRPJ" : t === "CSLL" ? "CSLL" : "";
        row.value = val.trim();
        return row;
      });

    if (newRows.length > 0) {
      setRows((prev) => {
        const hasBlank = prev.length === 1 && !isIrCsllRowValid(prev[0]);
        return hasBlank ? newRows : [...prev, ...newRows];
      });
    }
  }

  const validRows = rows.filter(isIrCsllRowValid);
  const uniqueNames = [...new Set(validRows.map((r) => r.point_name.trim()))];

  function goToMatch() {
    if (validRows.length === 0) {
      toast.error("Nenhuma linha válida. Verifique Nome, Ano, Tipo e Valor.");
      return;
    }
    // inicializa matches para novos nomes
    const next: Record<string, PointMatch> = {};
    for (const name of uniqueNames) {
      next[name] = matches[name] ?? computeAutoMatch(candidates, name);
    }
    setMatches(next);
    setStep("match");
  }

  const unresolvedCount = uniqueNames.filter(
    (n) => (matches[n]?.mode ?? "unresolved") === "unresolved",
  ).length;

  async function handleCommit() {
    if (unresolvedCount > 0) {
      toast.error(`${unresolvedCount} ponto(s) ainda não confirmado(s).`);
      return;
    }

    setCommitting(true);
    try {
      const idByName = new Map<string, number>();
      for (const name of uniqueNames) {
        const m = matches[name];
        if (m.mode === "existing") {
          idByName.set(name, m.pointId);
        } else if (m.mode === "new") {
          const created = await creditPointDefinitionsApi.quickCreate(
            m.category,
            "IRPJ_CSLL",
            m.name,
          );
          idByName.set(name, created.id);
        }
      }

      const finalRows: IrCsllResolvedRow[] = validRows
        .map((r) => {
          const id = idByName.get(r.point_name.trim());
          if (!id) return null;
          return {
            credit_point_definition_id: id,
            reference_year: Number(r.reference_year),
            tax_sub_type: r.tax_sub_type as "IRPJ" | "CSLL",
            value: parseValue(r.value),
          };
        })
        .filter((r): r is IrCsllResolvedRow => r !== null);

      const res = await onCommit(finalRows);
      toast.success(`${res.inserted} valor(es) importado(s) em ${uniqueNames.length} ponto(s).`);
      handleClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar dados.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Inserir Pontos IR/CSLL manualmente</DialogTitle>
        </DialogHeader>

        {/* Indicador de etapa */}
        <div className="flex items-center gap-3 text-xs">
          <div
            className={`flex items-center gap-1.5 ${
              step === "grid" ? "text-primary font-medium" : "text-muted-foreground"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center border text-[10px] ${
                step === "grid"
                  ? "border-primary text-primary"
                  : "border-success bg-success text-success-foreground"
              }`}
            >
              {step === "match" ? <Check className="h-3 w-3" /> : "1"}
            </span>
            Inserir dados
          </div>
          <div className="w-6 h-px bg-border" />
          <div
            className={`flex items-center gap-1.5 ${
              step === "match" ? "text-primary font-medium" : "text-muted-foreground"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center border text-[10px] ${
                step === "match" ? "border-primary text-primary" : "border-border"
              }`}
            >
              2
            </span>
            Confirmar pontos
          </div>
        </div>

        {step === "grid" && (
          <>
            <p className="text-sm text-muted-foreground">
              Preencha os dados ou <strong>cole do Excel</strong> (colunas: Nome do Ponto, Ano,
              IRPJ/CSLL, Valor).
            </p>

            <div className="flex-1 overflow-auto border border-border rounded-lg min-h-0">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/60 border-b border-border sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground">
                      Nome do ponto <span className="text-destructive">*</span>
                    </th>
                    <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-24">
                      Ano <span className="text-destructive">*</span>
                    </th>
                    <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-28">
                      Tipo <span className="text-destructive">*</span>
                    </th>
                    <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-32">
                      Valor <span className="text-destructive">*</span>
                    </th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border" onPaste={handlePaste}>
                  {rows.map((row) => {
                    const hasAnyData =
                      row.point_name || row.reference_year || row.tax_sub_type || row.value;
                    const valid = isIrCsllRowValid(row);
                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-muted/20 ${hasAnyData && !valid ? "bg-destructive/5" : ""}`}
                      >
                        <td className="px-1 py-1">
                          <Input
                            className="h-8 text-xs"
                            value={row.point_name}
                            onChange={(e) => updateRow(row.id, "point_name", e.target.value)}
                            placeholder="Nome do ponto"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            className={`h-8 text-xs font-mono ${
                              row.reference_year && !isValidYear(row.reference_year)
                                ? "border-destructive"
                                : ""
                            }`}
                            value={row.reference_year}
                            onChange={(e) => updateRow(row.id, "reference_year", e.target.value)}
                            placeholder="2023"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Select
                            value={row.tax_sub_type}
                            onValueChange={(v) => updateRow(row.id, "tax_sub_type", v)}
                          >
                            <SelectTrigger className="h-8 text-xs">
                              <SelectValue placeholder="—" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="IRPJ">IRPJ</SelectItem>
                              <SelectItem value="CSLL">CSLL</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            className={`h-8 text-xs text-right ${
                              row.value && isNaN(parseValue(row.value)) ? "border-destructive" : ""
                            }`}
                            value={row.value}
                            onChange={(e) => updateRow(row.id, "value", e.target.value)}
                            placeholder="0,00"
                          />
                        </td>
                        <td className="px-1 py-1 text-center">
                          {rows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeRow(row.id)}
                              className="text-muted-foreground hover:text-destructive p-1 rounded"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="h-4 w-4" /> Adicionar linha
              </Button>
              <span className="text-xs text-muted-foreground ml-auto">
                {validRows.length} linha(s) válida(s) · {uniqueNames.length} ponto(s) único(s)
              </span>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancelar
              </Button>
              <Button onClick={goToMatch} disabled={validRows.length === 0}>
                Confirmar pontos <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "match" && (
          <>
            <p className="text-sm text-muted-foreground">
              Confirme ou corrija a correspondência de cada ponto com o catálogo de{" "}
              <strong>IRPJ/CSLL</strong>.
              {unresolvedCount > 0 && (
                <span className="text-amber-600">
                  {" "}
                  · {unresolvedCount} ponto(s) pendente(s) de confirmação.
                </span>
              )}
            </p>

            <div className="flex-1 overflow-auto border border-border rounded-lg min-h-0 divide-y divide-border">
              {uniqueNames.map((name) => (
                <div key={name} className="px-3 py-2.5 space-y-2">
                  <p className="text-sm font-medium">{name}</p>
                  <InlinePointPicker
                    candidates={candidates}
                    value={matches[name] ?? { mode: "unresolved" }}
                    onChange={(m) => setMatches((prev) => ({ ...prev, [name]: m }))}
                    defaultNewName={name}
                    taxLabel="IRPJ/CSLL"
                  />
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              {validRows.length} valor(es) de {uniqueNames.length} ponto(s) serão importados.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("grid")}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button
                onClick={handleCommit}
                disabled={committing || unresolvedCount > 0}
              >
                {committing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Importar {validRows.length} valor(es)
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════════
// InssManualEntryModal — grade de dados + etapa de match (2 passos)
// ═════════════════════════════════════════════════════════════════════════════

type InssStep = "grid" | "match";

interface InssRow {
  id: string;
  point_name: string;
  reference_year: string;
  value: string;
}

function newInssRow(): InssRow {
  return { id: uid(), point_name: "", reference_year: "", value: "" };
}

function isInssRowValid(r: InssRow): boolean {
  return (
    r.point_name.trim().length > 0 &&
    isValidYear(r.reference_year) &&
    !isNaN(parseValue(r.value))
  );
}

export function InssManualEntryModal({
  open,
  onOpenChange,
  onCommit,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCommit: (rows: InssResolvedRow[]) => Promise<{ inserted: number }>;
}) {
  const [step, setStep] = useState<InssStep>("grid");
  const [rows, setRows] = useState<InssRow[]>([newInssRow()]);
  const [matches, setMatches] = useState<Record<string, PointMatch>>({});
  const [committing, setCommitting] = useState(false);

  const { data: candidates = [] } = useQuery({
    queryKey: ["point-definitions", "INSS", "CREDITO"],
    queryFn: () => creditPointDefinitionsApi.list({ tax: "INSS", nature: "CREDITO" }),
    enabled: open,
  });

  function reset() {
    setStep("grid");
    setRows([newInssRow()]);
    setMatches({});
  }

  function handleClose(v: boolean) {
    if (!v) reset();
    onOpenChange(v);
  }

  function addRow() {
    setRows((r) => [...r, newInssRow()]);
  }

  function removeRow(id: string) {
    setRows((r) => (r.length > 1 ? r.filter((row) => row.id !== id) : r));
  }

  function updateRow(id: string, field: keyof InssRow, val: string) {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, [field]: val } : row)));
  }

  function handlePaste(e: React.ClipboardEvent<HTMLTableSectionElement>) {
    const text = e.clipboardData.getData("text/plain");
    if (!text.includes("\t") && !text.includes("\n")) return;
    e.preventDefault();

    const newRows: InssRow[] = text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => {
        const [name = "", year = "", val = ""] = line.split("\t");
        const row = newInssRow();
        row.point_name = name.trim();
        row.reference_year = year.trim();
        row.value = val.trim();
        return row;
      });

    if (newRows.length > 0) {
      setRows((prev) => {
        const hasBlank = prev.length === 1 && !isInssRowValid(prev[0]);
        return hasBlank ? newRows : [...prev, ...newRows];
      });
    }
  }

  const validRows = rows.filter(isInssRowValid);
  const uniqueNames = [...new Set(validRows.map((r) => r.point_name.trim()))];

  function goToMatch() {
    if (validRows.length === 0) {
      toast.error("Nenhuma linha válida. Verifique Nome, Ano e Valor.");
      return;
    }
    const next: Record<string, PointMatch> = {};
    for (const name of uniqueNames) {
      next[name] = matches[name] ?? computeAutoMatch(candidates, name);
    }
    setMatches(next);
    setStep("match");
  }

  const unresolvedCount = uniqueNames.filter(
    (n) => (matches[n]?.mode ?? "unresolved") === "unresolved",
  ).length;

  async function handleCommit() {
    if (unresolvedCount > 0) {
      toast.error(`${unresolvedCount} ponto(s) ainda não confirmado(s).`);
      return;
    }

    setCommitting(true);
    try {
      const idByName = new Map<string, number>();
      for (const name of uniqueNames) {
        const m = matches[name];
        if (m.mode === "existing") {
          idByName.set(name, m.pointId);
        } else if (m.mode === "new") {
          const created = await creditPointDefinitionsApi.quickCreate(m.category, "INSS", m.name);
          idByName.set(name, created.id);
        }
      }

      const finalRows: InssResolvedRow[] = validRows
        .map((r) => {
          const id = idByName.get(r.point_name.trim());
          if (!id) return null;
          return {
            credit_point_definition_id: id,
            reference_year: Number(r.reference_year),
            value: parseValue(r.value),
          };
        })
        .filter((r): r is InssResolvedRow => r !== null);

      const res = await onCommit(finalRows);
      toast.success(`${res.inserted} valor(es) importado(s) em ${uniqueNames.length} ponto(s).`);
      handleClose(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar dados.");
    } finally {
      setCommitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl max-h-[90vh] flex flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Inserir Pontos INSS manualmente</DialogTitle>
        </DialogHeader>

        {/* Indicador de etapa */}
        <div className="flex items-center gap-3 text-xs">
          <div
            className={`flex items-center gap-1.5 ${
              step === "grid" ? "text-primary font-medium" : "text-muted-foreground"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center border text-[10px] ${
                step === "grid"
                  ? "border-primary text-primary"
                  : "border-success bg-success text-success-foreground"
              }`}
            >
              {step === "match" ? <Check className="h-3 w-3" /> : "1"}
            </span>
            Inserir dados
          </div>
          <div className="w-6 h-px bg-border" />
          <div
            className={`flex items-center gap-1.5 ${
              step === "match" ? "text-primary font-medium" : "text-muted-foreground"
            }`}
          >
            <span
              className={`h-5 w-5 rounded-full flex items-center justify-center border text-[10px] ${
                step === "match" ? "border-primary text-primary" : "border-border"
              }`}
            >
              2
            </span>
            Confirmar pontos
          </div>
        </div>

        {step === "grid" && (
          <>
            <p className="text-sm text-muted-foreground">
              Preencha os dados ou <strong>cole do Excel</strong> (colunas: Nome do Ponto, Ano,
              Valor).
            </p>

            <div className="flex-1 overflow-auto border border-border rounded-lg min-h-0">
              <table className="w-full text-sm border-collapse">
                <thead className="bg-muted/60 border-b border-border sticky top-0">
                  <tr>
                    <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground">
                      Nome do ponto <span className="text-destructive">*</span>
                    </th>
                    <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-24">
                      Ano <span className="text-destructive">*</span>
                    </th>
                    <th className="text-left px-2 py-2 font-medium text-xs text-muted-foreground w-32">
                      Valor <span className="text-destructive">*</span>
                    </th>
                    <th className="w-8" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-border" onPaste={handlePaste}>
                  {rows.map((row) => {
                    const hasAnyData = row.point_name || row.reference_year || row.value;
                    const valid = isInssRowValid(row);
                    return (
                      <tr
                        key={row.id}
                        className={`hover:bg-muted/20 ${hasAnyData && !valid ? "bg-destructive/5" : ""}`}
                      >
                        <td className="px-1 py-1">
                          <Input
                            className="h-8 text-xs"
                            value={row.point_name}
                            onChange={(e) => updateRow(row.id, "point_name", e.target.value)}
                            placeholder="Nome do ponto"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            className={`h-8 text-xs font-mono ${
                              row.reference_year && !isValidYear(row.reference_year)
                                ? "border-destructive"
                                : ""
                            }`}
                            value={row.reference_year}
                            onChange={(e) => updateRow(row.id, "reference_year", e.target.value)}
                            placeholder="2023"
                          />
                        </td>
                        <td className="px-1 py-1">
                          <Input
                            className={`h-8 text-xs text-right ${
                              row.value && isNaN(parseValue(row.value)) ? "border-destructive" : ""
                            }`}
                            value={row.value}
                            onChange={(e) => updateRow(row.id, "value", e.target.value)}
                            placeholder="0,00"
                          />
                        </td>
                        <td className="px-1 py-1 text-center">
                          {rows.length > 1 && (
                            <button
                              type="button"
                              onClick={() => removeRow(row.id)}
                              className="text-muted-foreground hover:text-destructive p-1 rounded"
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={addRow}>
                <Plus className="h-4 w-4" /> Adicionar linha
              </Button>
              <span className="text-xs text-muted-foreground ml-auto">
                {validRows.length} linha(s) válida(s) · {uniqueNames.length} ponto(s) único(s)
              </span>
            </div>

            <DialogFooter>
              <Button variant="outline" onClick={() => handleClose(false)}>
                Cancelar
              </Button>
              <Button onClick={goToMatch} disabled={validRows.length === 0}>
                Confirmar pontos <ArrowRight className="h-4 w-4" />
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "match" && (
          <>
            <p className="text-sm text-muted-foreground">
              Confirme ou corrija a correspondência de cada ponto com o catálogo de{" "}
              <strong>INSS</strong>.
              {unresolvedCount > 0 && (
                <span className="text-amber-600">
                  {" "}
                  · {unresolvedCount} ponto(s) pendente(s) de confirmação.
                </span>
              )}
            </p>

            <div className="flex-1 overflow-auto border border-border rounded-lg min-h-0 divide-y divide-border">
              {uniqueNames.map((name) => (
                <div key={name} className="px-3 py-2.5 space-y-2">
                  <p className="text-sm font-medium">{name}</p>
                  <InlinePointPicker
                    candidates={candidates}
                    value={matches[name] ?? { mode: "unresolved" }}
                    onChange={(m) => setMatches((prev) => ({ ...prev, [name]: m }))}
                    defaultNewName={name}
                    taxLabel="INSS"
                  />
                </div>
              ))}
            </div>

            <p className="text-xs text-muted-foreground">
              {validRows.length} valor(es) de {uniqueNames.length} ponto(s) serão importados.
            </p>

            <DialogFooter>
              <Button variant="outline" onClick={() => setStep("grid")}>
                <ArrowLeft className="h-4 w-4" /> Voltar
              </Button>
              <Button
                onClick={handleCommit}
                disabled={committing || unresolvedCount > 0}
              >
                {committing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4" />
                )}
                Importar {validRows.length} valor(es)
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}