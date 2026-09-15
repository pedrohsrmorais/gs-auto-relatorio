import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  CheckCircle2, FileUp, ClipboardPaste as PasteIcon, ArrowLeft, ArrowRight,
  Loader2, AlertTriangle, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

import { FileDropzone, MultiFileDropzone, PasteArea } from "./ImportSourceInputs";

import {
  parseXlsxRawMatrix, parsePastedMatrix, parseXlsxNamedSheetMatrixKeepBlanks,
} from "@/lib/import/parseUtils";
import {
  parseIpiComparativo, type ParseIpiComparativoResult, type ParsedIpiMonthlyRow,
  parseIrCsllTotais, type ParsedIrCsllRow,
  parseInssTotais, type ParsedInssRow, INSS_TOTAIS_TEMPLATE_ORDER,
} from "@/lib/import/customParsers";
import { creditPointDefinitionsApi, type PointDefinition, type TaxCode } from "@/lib/api";

/* =====================================================================
 * IpiIrCsllWizards.tsx
 *
 * IPI e IR/CSLL não têm ID_PONTO na planilha de origem — só o nome. E o
 * catálogo pode ter nomes repetidos com IDs diferentes (ex.: "PAT" existe
 * como ponto de crédito E como ponto passivo). Por isso NENHUM desses
 * wizards casa por nome e cria silenciosamente: eles sempre mostram ao
 * usuário qual ponto do catálogo foi identificado (nome + ID_PONTO) para
 * confirmação, e oferecem busca manual + criação explícita quando não há
 * match. Ver <PointMatchPicker /> abaixo — é o núcleo dessa garantia,
 * compartilhado pelos 3 wizards.
 *
 *  - IpiPontoImportWizard      → 1 arquivo/paste = 1 ponto IPI
 *  - IpiMultiImportWizard      → N arquivos = N pontos IPI, em lote
 *  - IrCsllImportWizard        → 1 arquivo = N pontos IR/CSLL, lidos da
 *                                 aba "Totais" (só aceita arquivo, a
 *                                 estrutura é rígida demais pra colar texto)
 * ===================================================================== */

type SourceMethod = "file" | "paste";

function WizardSteps<S extends string>({
  steps, labels, currentIndex,
}: {
  steps: readonly S[];
  labels: Record<S, string>;
  currentIndex: number;
}) {
  return (
    <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
      {steps.map((s, i) => (
        <div key={s} className="flex items-center gap-2">
          <span className={`h-6 w-6 rounded-full flex items-center justify-center border ${
            i < currentIndex ? "bg-success text-success-foreground border-success" :
            i === currentIndex ? "border-primary text-primary" : "border-border text-muted-foreground"
          }`}>
            {i < currentIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
          </span>
          <span className={i === currentIndex ? "font-medium" : "text-muted-foreground"}>{labels[s]}</span>
          {i < steps.length - 1 && <div className="w-6 h-px bg-border" />}
        </div>
      ))}
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// Match de ponto contra o catálogo — compartilhado por IPI e IR/CSLL
// ═════════════════════════════════════════════════════════════════════════

function normalizeMatch(s: string): string {
  return s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export type MatchSelection =
  | { mode: "existing"; pointId: number }
  | { mode: "new"; name: string; category: "ADM" | "FTX" }
  | { mode: "unresolved" };

/** Pontos do catálogo cujo nome normalizado bate exatamente com o alvo. */
function findExactMatches(candidates: PointDefinition[], targetName: string): PointDefinition[] {
  const norm = normalizeMatch(targetName);
  return candidates.filter((c) => normalizeMatch(c.name) === norm);
}

/** Decide o valor inicial do match: 1 batida exata = confirma; 0 ou 2+ = precisa decisão do usuário. */
function computeInitialMatch(candidates: PointDefinition[], targetName: string): MatchSelection {
  const matches = findExactMatches(candidates, targetName);
  if (matches.length === 1) return { mode: "existing", pointId: matches[0].id };
  return { mode: "unresolved" };
}

function PointMatchPicker({
  candidates, value, onChange, defaultNewName, taxLabel,
}: {
  candidates: PointDefinition[];
  value: MatchSelection;
  onChange: (v: MatchSelection) => void;
  defaultNewName: string;
  taxLabel: string;
}) {
  const [searching, setSearching] = useState(value.mode === "unresolved");
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState(defaultNewName);
  const [newCategory, setNewCategory] = useState<"ADM" | "FTX">(value.mode === "new" ? value.category : "ADM");

  useEffect(() => { if (value.mode === "unresolved") setSearching(true); }, [value.mode]);

  const filtered = search.trim()
    ? candidates.filter((c) =>
        normalizeMatch(c.name).includes(normalizeMatch(search)) || c.external_id.includes(search.trim())
      )
    : candidates;

  if (value.mode === "existing" && !searching) {
    const point = candidates.find((c) => c.id === value.pointId);
    return (
      <div className="flex items-center gap-2 text-sm min-w-0">
        <Badge variant="success" className="shrink-0 gap-1"><Check className="h-3 w-3" /> ID {point?.external_id ?? value.pointId}</Badge>
        {point && <Badge variant={point.category === "ADM" ? "secondary" : "outline"} className="shrink-0 text-xs">{point.category}</Badge>}
        <span className="truncate">{point?.name ?? `Ponto #${value.pointId}`}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs shrink-0" onClick={() => setSearching(true)}>Trocar</Button>
      </div>
    );
  }

  if (value.mode === "new" && !searching) {
    return (
      <div className="flex items-center gap-2 text-sm min-w-0">
        <Badge variant="warning" className="shrink-0">Ponto novo</Badge>
        <Badge variant={value.category === "ADM" ? "secondary" : "outline"} className="shrink-0 text-xs">{value.category}</Badge>
        <span className="truncate">{value.name}</span>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-xs shrink-0" onClick={() => setSearching(true)}>Trocar</Button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 w-full max-w-md">
      {value.mode === "unresolved" && (
        <p className="text-xs text-amber-600 flex items-center gap-1">
          <AlertTriangle className="h-3 w-3" /> Não encontrado no catálogo — busque ou crie um novo ponto.
        </p>
      )}
      <div className="flex items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar ponto por nome ou ID (ADM e FTX)…"
          className="h-8 text-sm"
        />
        {value.mode !== "unresolved" && (
          <Button size="sm" variant="ghost" className="h-8 px-2 text-xs shrink-0" onClick={() => setSearching(false)}>Cancelar</Button>
        )}
      </div>
      <div className="max-h-36 overflow-auto border border-border rounded-md divide-y divide-border">
        {filtered.slice(0, 30).map((c) => (
          <button
            key={c.id} type="button"
            className="w-full text-left px-2 py-1.5 text-sm hover:bg-muted flex items-center gap-2"
            onClick={() => { onChange({ mode: "existing", pointId: c.id }); setSearching(false); }}
          >
            <span className="font-mono text-xs bg-muted px-1 rounded shrink-0">ID {c.external_id}</span>
            <Badge variant={c.category === "ADM" ? "secondary" : "outline"} className="shrink-0 text-xs">{c.category}</Badge>
            <span className="truncate">{c.name}</span>
          </button>
        ))}
        {filtered.length === 0 && (
          <p className="px-2 py-2 text-xs text-muted-foreground">Nenhum ponto encontrado no catálogo de {taxLabel} (ADM ou FTX).</p>
        )}
      </div>
      <div className="space-y-1.5 border-t border-border pt-1.5">
        <div className="flex items-center gap-2">
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} className="h-8 text-sm flex-1" placeholder="Nome do novo ponto" />
          <div className="flex items-center gap-1 shrink-0 bg-muted rounded-md p-0.5">
            {(["ADM", "FTX"] as const).map((cat) => (
              <button
                key={cat} type="button"
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
          size="sm" variant="outline" className="h-8 text-xs w-full"
          onClick={() => { onChange({ mode: "new", name: newName.trim() || defaultNewName, category: newCategory }); setSearching(false); }}
          disabled={!newName.trim() && !defaultNewName.trim()}
        >
          Criar novo ponto {taxLabel} — {newCategory}
        </Button>
      </div>
    </div>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// IpiPontoImportWizard — 1 arquivo/paste = 1 ponto
// ═════════════════════════════════════════════════════════════════════════

type IpiStep = "method" | "source" | "review" | "done";
const IPI_STEP_ORDER: IpiStep[] = ["method", "source", "review", "done"];
const IPI_STEP_LABEL: Record<IpiStep, string> = { method: "Método", source: "Dados", review: "Conferir ponto", done: "Concluído" };

export function IpiPontoImportWizard({
  open, onOpenChange, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** pointId já resolvido (existente ou recém-criado) pelo próprio wizard. */
  onCommit: (pointId: number, pointName: string, rows: ParsedIpiMonthlyRow[]) => Promise<{ inserted: number; pointName: string }>;
}) {
  const [step, setStep] = useState<IpiStep>("method");
  const [method, setMethod] = useState<SourceMethod | null>(null);
  const [pointNameOverride, setPointNameOverride] = useState("");
  const [parsed, setParsed] = useState<ParseIpiComparativoResult | null>(null);
  const [match, setMatch] = useState<MatchSelection>({ mode: "unresolved" });
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; pointName: string } | null>(null);

  const { data: candidates = [] } = useQuery({
    queryKey: ["point-definitions", "IPI", "CREDITO"],
    queryFn: () => creditPointDefinitionsApi.list({ tax: "IPI", nature: "CREDITO" }),
    enabled: open,
  });

  function reset() {
    setStep("method"); setMethod(null); setPointNameOverride(""); setParsed(null);
    setMatch({ mode: "unresolved" }); setResult(null);
  }
  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function applyGrid(grid: string[][]) {
    const res = parseIpiComparativo(grid, pointNameOverride || undefined);
    setParsed(res);
    res.warnings.forEach((w) => toast.warning(w));
    if (res.pointName && candidates.length > 0) {
      setMatch(computeInitialMatch(candidates, res.pointName));
    }
    setStep("review");
  }

  async function handleFile(file: File) {
    try {
      const grid = await parseXlsxRawMatrix(file);
      applyGrid(grid);
    } catch {
      toast.error("Não foi possível ler o arquivo. Tente colar os dados manualmente.");
      setMethod("paste");
    }
  }
  function handlePasteText(text: string) {
    applyGrid(parsePastedMatrix(text));
  }

  async function handleCommit() {
    if (!parsed || parsed.rows.length === 0) {
      toast.error("Não há valores para importar.");
      return;
    }
    if (match.mode === "unresolved") {
      toast.error("Confirme o ponto do catálogo (ou crie um novo) antes de importar.");
      return;
    }
    setCommitting(true);
    try {
      let pointId: number;
      let pointName: string;
      if (match.mode === "new") {
        const created = await creditPointDefinitionsApi.quickCreate(match.category, "IPI", match.name);
        pointId = created.id;
        pointName = created.name;
      } else {
        pointId = match.pointId;
        pointName = candidates.find((c) => c.id === match.pointId)?.name ?? parsed.pointName ?? "";
      }
      const res = await onCommit(pointId, pointName, parsed.rows);
      setResult(res);
      setStep("done");
      toast.success(`${res.inserted} valor(es) importado(s) para "${res.pointName}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar os dados do ponto.");
    } finally {
      setCommitting(false);
    }
  }

  const stepIndex = IPI_STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Importar ponto ADM IPI</DialogTitle></DialogHeader>

        <WizardSteps steps={IPI_STEP_ORDER} labels={IPI_STEP_LABEL} currentIndex={stepIndex} />

        {step === "method" && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Nome do ponto (opcional — por padrão é extraído do título da aba "Comparativo", ex.: "Desembaraço Aduaneiro - IPI")
              </Label>
              <Input value={pointNameOverride} onChange={(e) => setPointNameOverride(e.target.value)} placeholder='ex: "Desembaraço Aduaneiro"' />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button onClick={() => { setMethod("file"); setStep("source"); }}
                className="flex flex-col items-center gap-3 border border-border rounded-xl p-8 hover:border-primary/50 hover:bg-muted/50 transition-colors">
                <FileUp className="h-8 w-8 text-primary" />
                <p className="font-medium text-sm">Enviar planilha (.xlsx)</p>
              </button>
              <button onClick={() => { setMethod("paste"); setStep("source"); }}
                className="flex flex-col items-center gap-3 border border-border rounded-xl p-8 hover:border-primary/50 hover:bg-muted/50 transition-colors">
                <PasteIcon className="h-8 w-8 text-primary" />
                <p className="font-medium text-sm">Colar dados do Excel</p>
              </button>
            </div>
          </div>
        )}

        {step === "source" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Envie a aba "Comparativo" do padrão de IPI (com o título do ponto na primeira linha e os blocos
              de ano com a linha "Créditos de IPI").
            </p>
            {method === "file" ? <FileDropzone onFile={handleFile} /> : <PasteArea onChangeText={handlePasteText} />}
            <div className="flex justify-start pt-2">
              <Button variant="outline" onClick={() => setStep("method")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
            </div>
          </div>
        )}

        {step === "review" && parsed && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Ponto identificado no catálogo de IPI</p>
              <PointMatchPicker
                candidates={candidates}
                value={match}
                onChange={setMatch}
                defaultNewName={parsed.pointName ?? pointNameOverride}
                taxLabel="IPI"
              />
            </div>
            <p className="text-sm">
              <strong>{parsed.rows.length}</strong> valor(es) mensais serão importados.
            </p>
            {parsed.warnings.length > 0 && (
              <ul className="text-xs text-warning space-y-1">
                {parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("source")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={handleCommit} disabled={committing || match.mode === "unresolved" || parsed.rows.length === 0}>
                {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Importar {parsed.rows.length} valor(es)
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="font-medium">{result.inserted} valor(es) importado(s) para "{result.pointName}".</p>
            <Button onClick={() => handleClose(false)}>Concluir</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// IpiMultiImportWizard — N arquivos = N pontos IPI, em lote
// ═════════════════════════════════════════════════════════════════════════

type IpiMultiStep = "source" | "review" | "importing" | "done";
const IPI_MULTI_STEP_ORDER: IpiMultiStep[] = ["source", "review", "importing", "done"];
const IPI_MULTI_STEP_LABEL: Record<IpiMultiStep, string> = {
  source: "Arquivos", review: "Conferir pontos", importing: "Importando", done: "Concluído",
};

interface IpiParsedGroup {
  key: string;
  fileName: string;
  pointName: string | null;
  rows: ParsedIpiMonthlyRow[];
  warnings: string[];
  match: MatchSelection;
}

interface IpiCommitOutcome {
  key: string;
  fileName: string;
  pointName: string;
  inserted: number;
  error?: string;
}

export function IpiMultiImportWizard({
  open, onOpenChange, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (pointId: number, pointName: string, rows: ParsedIpiMonthlyRow[]) => Promise<{ inserted: number; pointName: string }>;
}) {
  const [step, setStep] = useState<IpiMultiStep>("source");
  const [files, setFiles] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [groups, setGroups] = useState<IpiParsedGroup[]>([]);
  const [results, setResults] = useState<IpiCommitOutcome[]>([]);

  const { data: candidates = [] } = useQuery({
    queryKey: ["point-definitions", "IPI", "CREDITO"],
    queryFn: () => creditPointDefinitionsApi.list({ tax: "IPI", nature: "CREDITO" }),
    enabled: open,
  });

  function reset() { setStep("source"); setFiles([]); setParsing(false); setGroups([]); setResults([]); }
  function handleClose(next: boolean) { if (!next) reset(); onOpenChange(next); }

  async function handleParseAll() {
    if (files.length === 0) { toast.error("Selecione ao menos uma planilha."); return; }
    setParsing(true);
    const next: IpiParsedGroup[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      try {
        const grid = await parseXlsxRawMatrix(file);
        const res = parseIpiComparativo(grid);
        const initialMatch = res.pointName ? computeInitialMatch(candidates, res.pointName) : { mode: "unresolved" as const };
        next.push({ key: `${file.name}_${i}`, fileName: file.name, pointName: res.pointName, rows: res.rows, warnings: res.warnings, match: initialMatch });
      } catch {
        next.push({ key: `${file.name}_${i}`, fileName: file.name, pointName: null, rows: [], warnings: ["Não foi possível ler este arquivo."], match: { mode: "unresolved" } });
      }
    }
    setGroups(next);
    setParsing(false);
    setStep("review");
  }

  function updateMatch(key: string, match: MatchSelection) {
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, match } : g)));
  }

  const validGroups = groups.filter((g) => g.rows.length > 0 && g.match.mode !== "unresolved");
  const invalidGroups = groups.filter((g) => g.rows.length === 0 || g.match.mode === "unresolved");

  async function handleCommitAll() {
    setStep("importing");
    const outcomes: IpiCommitOutcome[] = [];

    for (const g of invalidGroups) {
      outcomes.push({ key: g.key, fileName: g.fileName, pointName: g.pointName ?? "", inserted: 0, error: g.rows.length === 0 ? "Sem valores para importar." : "Ponto não confirmado — pule esta etapa e confirme na revisão." });
    }
    for (const g of validGroups) {
      try {
        let pointId: number;
        let pointName: string;
        if (g.match.mode === "new") {
          const created = await creditPointDefinitionsApi.quickCreate(g.match.category, "IPI", g.match.name);
          pointId = created.id; pointName = created.name;
        } else if (g.match.mode === "existing") {
          const matchedId = g.match.pointId; // extraído para variável local: g.match.pointId dentro do .find() abaixo não narrowa (property access em objeto mutável)
          pointId = matchedId;
          pointName = candidates.find((c) => c.id === matchedId)?.name ?? g.pointName ?? "";
        } else {
          continue;
        }
        const res = await onCommit(pointId, pointName, g.rows);
        outcomes.push({ key: g.key, fileName: g.fileName, pointName: res.pointName, inserted: res.inserted });
      } catch (err) {
        outcomes.push({ key: g.key, fileName: g.fileName, pointName: g.pointName ?? "", inserted: 0, error: err instanceof Error ? err.message : "Erro ao importar." });
      }
    }

    setResults(outcomes);
    setStep("done");

    const totalInserted = outcomes.reduce((s, o) => s + o.inserted, 0);
    const errorCount = outcomes.filter((o) => o.error).length;
    if (errorCount === 0) toast.success(`${totalInserted} valor(es) importado(s) em ${outcomes.length} ponto(s).`);
    else toast.warning(`Importação concluída com ${errorCount} erro/aviso(s). Confira o resumo.`);
  }

  const stepIndex = IPI_MULTI_STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Importar pontos ADM IPI — em lote</DialogTitle></DialogHeader>

        <WizardSteps steps={IPI_MULTI_STEP_ORDER} labels={IPI_MULTI_STEP_LABEL} currentIndex={stepIndex} />

        {step === "source" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Selecione várias planilhas .xlsx de uma vez — cada arquivo deve corresponder a um único
              ponto IPI (aba "Comparativo" no padrão IPI).
            </p>
            <MultiFileDropzone files={files} onFilesChange={setFiles} />
            <div className="flex justify-end pt-2">
              <Button onClick={handleParseAll} disabled={files.length === 0 || parsing}>
                {parsing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
                Analisar {files.length > 0 ? `${files.length} arquivo(s)` : "planilhas"}
              </Button>
            </div>
          </div>
        )}

        {step === "review" && (
          <div className="space-y-4 py-2">
            <p className="text-sm">
              <strong>{validGroups.length}</strong> ponto(s) confirmados para importar
              {invalidGroups.length > 0 && (
                <span className="text-warning"> · {invalidGroups.length} pendente(s) de confirmação ou sem valores</span>
              )}
              .
            </p>
            <div className="border border-border rounded-lg divide-y divide-border max-h-[50vh] overflow-auto">
              {groups.map((g) => (
                <div key={g.key} className={`px-3 py-2.5 space-y-2 ${g.rows.length === 0 ? "bg-destructive/5" : ""}`}>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="max-w-[240px] truncate" title={g.fileName}>{g.fileName}</span>
                    <span>· {g.rows.length} valor(es)</span>
                    {g.warnings.length > 0 && (
                      <Badge variant="destructive" title={g.warnings.join("; ")}><AlertTriangle className="h-3 w-3 mr-1" /> aviso</Badge>
                    )}
                  </div>
                  {g.rows.length > 0 && (
                    <PointMatchPicker
                      candidates={candidates}
                      value={g.match}
                      onChange={(m) => updateMatch(g.key, m)}
                      defaultNewName={g.pointName ?? ""}
                      taxLabel="IPI"
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("source")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={handleCommitAll} disabled={validGroups.length === 0}>
                <CheckCircle2 className="h-4 w-4" /> Importar {validGroups.length} ponto(s)
              </Button>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Importando os pontos, um por vez…</p>
          </div>
        )}

        {step === "done" && (
          <div className="space-y-4 py-2">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <p className="font-medium">Importação concluída.</p>
            </div>
            <div className="border border-border rounded-lg divide-y divide-border max-h-[45vh] overflow-auto">
              {results.map((r) => (
                <div key={r.key} className={`flex items-center justify-between gap-2 px-3 py-2 text-sm ${r.error ? "bg-destructive/5" : ""}`}>
                  <span className="max-w-[160px] truncate" title={r.fileName}>{r.fileName}</span>
                  <span>{r.pointName || "—"}</span>
                  <span>{r.inserted}</span>
                  {r.error ? <Badge variant="destructive" title={r.error}>Erro</Badge> : <Badge variant="success">OK</Badge>}
                </div>
              ))}
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => handleClose(false)}>Concluir</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// IrCsllImportWizard — 1 arquivo = N pontos, lidos da aba "Totais"
// ═════════════════════════════════════════════════════════════════════════

type IrCsllStep = "source" | "match" | "done";
const IRCSLL_STEP_ORDER: IrCsllStep[] = ["source", "match", "done"];
const IRCSLL_STEP_LABEL: Record<IrCsllStep, string> = { source: "Arquivo", match: "Conferir pontos", done: "Concluído" };

export interface IrCsllResolvedRow {
  credit_point_definition_id: number;
  reference_year: number;
  tax_sub_type: "IRPJ" | "CSLL";
  value: number;
}

export function IrCsllImportWizard({
  open, onOpenChange, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (rows: IrCsllResolvedRow[]) => Promise<{ inserted: number }>;
}) {
  const [step, setStep] = useState<IrCsllStep>("source");
  const [parsedRows, setParsedRows] = useState<ParsedIrCsllRow[]>([]);
  const [pointNames, setPointNames] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<string, MatchSelection>>({});
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number } | null>(null);

  const { data: candidates = [] } = useQuery({
    queryKey: ["point-definitions", "IRPJ_CSLL", "CREDITO"],
    queryFn: () => creditPointDefinitionsApi.list({ tax: "IRPJ_CSLL", nature: "CREDITO" }),
    enabled: open,
  });

  function reset() {
    setStep("source"); setParsedRows([]); setPointNames([]); setParseWarnings([]); setMatches({}); setResult(null);
  }
  function handleClose(next: boolean) { if (!next) reset(); onOpenChange(next); }

  async function handleFile(file: File) {
    try {
      const grid = await parseXlsxNamedSheetMatrixKeepBlanks(file, ["Totais"]);
      const res = parseIrCsllTotais(grid);
      setParsedRows(res.rows);
      setPointNames(res.pointNames);
      setParseWarnings(res.warnings);
      res.warnings.forEach((w) => toast.warning(w));

      const initialMatches: Record<string, MatchSelection> = {};
      for (const name of res.pointNames) {
        initialMatches[name] = candidates.length > 0 ? computeInitialMatch(candidates, name) : { mode: "unresolved" };
      }
      setMatches(initialMatches);
      setStep("match");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível ler a aba "Totais" do arquivo.');
    }
  }

  function updateMatch(name: string, match: MatchSelection) {
    setMatches((m) => ({ ...m, [name]: match }));
  }

  const unresolvedCount = pointNames.filter((n) => (matches[n]?.mode ?? "unresolved") === "unresolved").length;

  async function handleCommit() {
    if (parsedRows.length === 0) { toast.error("Nenhum valor para importar."); return; }
    if (unresolvedCount > 0) { toast.error(`${unresolvedCount} ponto(s) ainda não confirmado(s). Resolva todos antes de importar.`); return; }

    setCommitting(true);
    try {
      // Resolve pontos "novos" primeiro (cria no catálogo), monta mapa nome -> id
      const idByName = new Map<string, number>();
      for (const name of pointNames) {
        const match = matches[name];
        if (match.mode === "existing") {
          idByName.set(name, match.pointId);
        } else if (match.mode === "new") {
          const created = await creditPointDefinitionsApi.quickCreate(match.category, "IRPJ_CSLL", match.name);
          idByName.set(name, created.id);
        }
      }

      const finalRows: IrCsllResolvedRow[] = parsedRows
        .map((r) => {
          const id = idByName.get(r.point_name);
          if (!id) return null;
          return { credit_point_definition_id: id, reference_year: r.reference_year, tax_sub_type: r.tax_sub_type, value: r.value };
        })
        .filter((r): r is IrCsllResolvedRow => r !== null);

      const res = await onCommit(finalRows);
      setResult(res);
      setStep("done");
      toast.success(`${res.inserted} valor(es) importado(s) em ${pointNames.length} ponto(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar os dados de IR/CSLL.");
    } finally {
      setCommitting(false);
    }
  }

  const stepIndex = IRCSLL_STEP_ORDER.indexOf(step);
  const yearsCount = new Set(parsedRows.map((r) => r.reference_year)).size;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Importar Pontos IR/CSLL</DialogTitle></DialogHeader>

        <WizardSteps steps={IRCSLL_STEP_ORDER} labels={IRCSLL_STEP_LABEL} currentIndex={stepIndex} />

        {step === "source" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Envie a planilha completa de IR/CSLL do job (ex.: "88548 - Cliente IR REAL.xlsm"). Os valores são
              lidos automaticamente <strong>só da aba "Totais"</strong> — as demais abas (memória de cálculo de
              cada ponto) não são lidas. Não é possível colar texto para este formato, envie o arquivo original.
            </p>
            <FileDropzone onFile={handleFile} />
          </div>
        )}

        {step === "match" && (
          <div className="space-y-4 py-2">
            <p className="text-sm">
              <strong>{pointNames.length}</strong> ponto(s) encontrados na aba "Totais", cobrindo{" "}
              <strong>{yearsCount}</strong> ano(s) — total de <strong>{parsedRows.length}</strong> valores (IRPJ + CSLL).
              {unresolvedCount > 0 && <span className="text-amber-600"> · {unresolvedCount} pendente(s) de confirmação</span>}
            </p>

            <div className="border border-border rounded-lg divide-y divide-border max-h-[50vh] overflow-auto">
              {pointNames.map((name) => (
                <div key={name} className="px-3 py-2.5 space-y-2">
                  <p className="text-sm font-medium">{name}</p>
                  <PointMatchPicker
                    candidates={candidates}
                    value={matches[name] ?? { mode: "unresolved" }}
                    onChange={(m) => updateMatch(name, m)}
                    defaultNewName={name}
                    taxLabel="IRPJ/CSLL"
                  />
                </div>
              ))}
            </div>

            {parseWarnings.length > 0 && (
              <ul className="text-xs text-warning space-y-1">
                {parseWarnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("source")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={handleCommit} disabled={committing || parsedRows.length === 0 || unresolvedCount > 0}>
                {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Importar {parsedRows.length} valor(es)
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="font-medium">{result.inserted} valor(es) importado(s) em {pointNames.length} ponto(s).</p>
            <Button onClick={() => handleClose(false)}>Concluir</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// InssImportWizard — 1 arquivo = N pontos, lidos da aba "Totais" (anual,
// valor único por ponto, sem split). Único wizard com o toggle "usar ordem
// dos pontos como respaldo": a base de pontos de INSS ("Pontos_Prev") não
// tem um ID_PONTO de origem confiável, então quando um nome não bate
// exatamente com o catálogo, e o toggle está ligado, tenta achar pelo NOME
// ESPERADO naquela posição da planilha-padrão (INSS_TOTAIS_TEMPLATE_ORDER,
// construído a partir de exports reais de dois clientes diferentes — mesma
// ordem nos dois). Isso NUNCA cria ou decide nada sozinho: só pré-seleciona
// um candidato que o usuário ainda vê e pode trocar antes de confirmar.
// ═════════════════════════════════════════════════════════════════════════

type InssStep = "source" | "match" | "done";
const INSS_STEP_ORDER: InssStep[] = ["source", "match", "done"];
const INSS_STEP_LABEL: Record<InssStep, string> = { source: "Arquivo", match: "Conferir pontos", done: "Concluído" };

export interface InssResolvedRow {
  credit_point_definition_id: number;
  reference_year: number;
  value: number;
}

export function InssImportWizard({
  open, onOpenChange, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (rows: InssResolvedRow[]) => Promise<{ inserted: number }>;
}) {
  const [step, setStep] = useState<InssStep>("source");
  const [parsedRows, setParsedRows] = useState<ParsedInssRow[]>([]);
  const [pointNames, setPointNames] = useState<string[]>([]);
  const [parseWarnings, setParseWarnings] = useState<string[]>([]);
  const [matches, setMatches] = useState<Record<string, MatchSelection>>({});
  const [orderMatchedNames, setOrderMatchedNames] = useState<Set<string>>(new Set());
  const [useOrderFallback, setUseOrderFallback] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number } | null>(null);

  const { data: candidates = [] } = useQuery({
    queryKey: ["point-definitions", "INSS", "CREDITO"],
    queryFn: () => creditPointDefinitionsApi.list({ tax: "INSS", nature: "CREDITO" }),
    enabled: open,
  });

  function reset() {
    setStep("source"); setParsedRows([]); setPointNames([]); setParseWarnings([]);
    setMatches({}); setOrderMatchedNames(new Set()); setUseOrderFallback(false); setResult(null);
  }
  function handleClose(next: boolean) { if (!next) reset(); onOpenChange(next); }

  function recomputeMatches(names: string[], withOrderFallback: boolean) {
    const nextMatches: Record<string, MatchSelection> = {};
    const viaOrder = new Set<string>();

    names.forEach((name, idx) => {
      const exact = findExactMatches(candidates, name);
      if (exact.length === 1) {
        nextMatches[name] = { mode: "existing", pointId: exact[0].id };
        return;
      }

      if (withOrderFallback) {
        // idx é 0-based (posição da linha no arquivo); a lista canônica usa
        // "position" 1-based na mesma ordem — por isso INSS_TOTAIS_TEMPLATE_ORDER[idx].
        const templateEntry = INSS_TOTAIS_TEMPLATE_ORDER[idx];
        const byExternalId = templateEntry?.externalId
          ? candidates.find((c) => c.external_id === templateEntry.externalId)
          : undefined;
        if (byExternalId) {
          nextMatches[name] = { mode: "existing", pointId: byExternalId.id };
          viaOrder.add(name);
          return;
        }
      }

      nextMatches[name] = { mode: "unresolved" };
    });

    setMatches(nextMatches);
    setOrderMatchedNames(viaOrder);
  }

  async function handleFile(file: File) {
    try {
      const grid = await parseXlsxNamedSheetMatrixKeepBlanks(file, ["Totais"]);
      const res = parseInssTotais(grid);
      setParsedRows(res.rows);
      setPointNames(res.pointNames);
      setParseWarnings(res.warnings);
      res.warnings.forEach((w) => toast.warning(w));
      recomputeMatches(res.pointNames, useOrderFallback);
      setStep("match");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Não foi possível ler a aba "Totais" do arquivo.');
    }
  }

  function handleToggleOrderFallback(checked: boolean) {
    setUseOrderFallback(checked);
    recomputeMatches(pointNames, checked);
  }

  function updateMatch(name: string, match: MatchSelection) {
    setMatches((m) => ({ ...m, [name]: match }));
    setOrderMatchedNames((s) => {
      if (!s.has(name)) return s;
      const next = new Set(s);
      next.delete(name);
      return next;
    });
  }

  const unresolvedCount = pointNames.filter((n) => (matches[n]?.mode ?? "unresolved") === "unresolved").length;

  async function handleCommit() {
    if (parsedRows.length === 0) { toast.error("Nenhum valor para importar."); return; }
    if (unresolvedCount > 0) {
      toast.error(`${unresolvedCount} ponto(s) ainda não confirmado(s). Resolva todos antes de importar.`);
      return;
    }

    setCommitting(true);
    try {
      const idByName = new Map<string, number>();
      for (const name of pointNames) {
        const match = matches[name];
        if (match.mode === "existing") {
          idByName.set(name, match.pointId);
        } else if (match.mode === "new") {
          const created = await creditPointDefinitionsApi.quickCreate(match.category, "INSS", match.name);
          idByName.set(name, created.id);
        }
      }

      const finalRows: InssResolvedRow[] = parsedRows
        .map((r) => {
          const id = idByName.get(r.point_name);
          if (!id) return null;
          return { credit_point_definition_id: id, reference_year: r.reference_year, value: r.value };
        })
        .filter((r): r is InssResolvedRow => r !== null);

      const res = await onCommit(finalRows);
      setResult(res);
      setStep("done");
      toast.success(`${res.inserted} valor(es) importado(s) em ${pointNames.length} ponto(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar os dados de INSS.");
    } finally {
      setCommitting(false);
    }
  }

  const stepIndex = INSS_STEP_ORDER.indexOf(step);
  const yearsCount = new Set(parsedRows.map((r) => r.reference_year)).size;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Importar Pontos INSS</DialogTitle></DialogHeader>

        <WizardSteps steps={INSS_STEP_ORDER} labels={INSS_STEP_LABEL} currentIndex={stepIndex} />

        {step === "source" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Envie a planilha completa de INSS do job. Os valores são lidos automaticamente <strong>só da
              aba "Totais"</strong> — as demais abas (memória de cálculo de cada ponto) não são lidas. Não é
              possível colar texto para este formato, envie o arquivo original.
            </p>
            <FileDropzone onFile={handleFile} />
          </div>
        )}

        {step === "match" && (
          <div className="space-y-4 py-2">
            <label className="flex items-start gap-3 text-sm border border-border rounded-lg p-3 bg-muted/30 cursor-pointer select-none">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={useOrderFallback}
                onChange={(e) => handleToggleOrderFallback(e.target.checked)}
              />
              <span>
                <span className="font-medium">Usar ordem dos pontos como respaldo</span>
                <br />
                <span className="text-muted-foreground text-xs">
                  Quando um nome não bate exatamente com nenhum ponto do catálogo, tenta achar pelo nome
                  esperado naquela posição da planilha-padrão (ex.: a 1ª linha de pontos é sempre "RATxFAP",
                  a 2ª é sempre "Desoneração da Folha", e assim por diante). Só ajuda se esta planilha seguir
                  a mesma ordem do padrão — desligue se desconfiar que os pontos foram reordenados neste
                  arquivo. Pontos preenchidos assim ficam marcados "via ordem" e continuam editáveis.
                </span>
              </span>
            </label>

            <p className="text-sm">
              <strong>{pointNames.length}</strong> ponto(s) encontrados na aba "Totais", cobrindo{" "}
              <strong>{yearsCount}</strong> ano(s) — total de <strong>{parsedRows.length}</strong> valores.
              {unresolvedCount > 0 && <span className="text-amber-600"> · {unresolvedCount} pendente(s) de confirmação</span>}
            </p>

            <div className="border border-border rounded-lg divide-y divide-border max-h-[50vh] overflow-auto">
              {pointNames.map((name) => (
                <div key={name} className="px-3 py-2.5 space-y-2">
                  <p className="text-sm font-medium flex items-center gap-2">
                    {name}
                    {orderMatchedNames.has(name) && (
                      <Badge variant="outline" className="text-xs">via ordem</Badge>
                    )}
                  </p>
                  <PointMatchPicker
                    candidates={candidates}
                    value={matches[name] ?? { mode: "unresolved" }}
                    onChange={(m) => updateMatch(name, m)}
                    defaultNewName={name}
                    taxLabel="INSS"
                  />
                </div>
              ))}
            </div>

            {parseWarnings.length > 0 && (
              <ul className="text-xs text-warning space-y-1">
                {parseWarnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("source")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={handleCommit} disabled={committing || parsedRows.length === 0 || unresolvedCount > 0}>
                {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Importar {parsedRows.length} valor(es)
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="font-medium">{result.inserted} valor(es) importado(s) em {pointNames.length} ponto(s).</p>
            <Button onClick={() => handleClose(false)}>Concluir</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}