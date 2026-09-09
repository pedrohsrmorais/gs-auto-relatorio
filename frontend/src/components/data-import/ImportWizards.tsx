import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2, FileUp, ClipboardPaste as PasteIcon, ArrowLeft, ArrowRight,
  Loader2, ListOrdered, AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

import { FileDropzone, MultiFileDropzone, PasteArea } from "./ImportSourceInputs";
import { DataPreviewTable } from "./DataViewerModal";

import {
  autoMapColumns, buildPreview, mapColumnsByOrder, parsePastedText, parseXlsxFile,
  preprocessCompositeDateColumns, parseXlsxRawMatrix, parsePastedMatrix,
} from "@/lib/import/parseUtils";
import type { ImportPreviewResult, ImportTableConfig } from "@/lib/import/importConfigs";

import { parsePontoMatrix, type ParsedPontoMonthlyRow, type ParsePontoMatrixResult } from "@/lib/import/pontoMatrixParser";
import { parseCategoriaGrid, type ParsedCategoriaRow } from "@/lib/import/categoriaParser";
import { parseJobIdentification, type ParsedJobIdentification } from "@/lib/import/identificationParser";

// ═════════════════════════════════════════════════════════════════════════
// Compartilhado entre os wizards
// ═════════════════════════════════════════════════════════════════════════

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
// ImportWizard — genérico com mapeamento de colunas (PERDCOMP/DARF/M400/M610)
// ═════════════════════════════════════════════════════════════════════════

type ImportStep = "method" | "source" | "mapping" | "review" | "done";

const IMPORT_STEP_ORDER: ImportStep[] = ["method", "source", "mapping", "review", "done"];
const IMPORT_STEP_LABEL: Record<ImportStep, string> = {
  method: "Método", source: "Dados", mapping: "Colunas", review: "Revisão", done: "Concluído",
};

export function ImportWizard({
  open, onOpenChange, config, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  config: ImportTableConfig;
  onCommit: (rows: Record<string, unknown>[]) => Promise<{ inserted: number }>;
}) {
  const [step, setStep] = useState<ImportStep>("method");
  const [method, setMethod] = useState<SourceMethod | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, number | null>>({});
  const [mapByOrder, setMapByOrder] = useState(false);
  const [preview, setPreview] = useState<ImportPreviewResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number } | null>(null);

  function reset() {
    setStep("method"); setMethod(null); setHeaders([]); setRawRows([]);
    setMapping({}); setMapByOrder(false); setPreview(null); setResult(null);
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  }

  function applyParsed(h: string[], rows: string[][]) {
    const merged = preprocessCompositeDateColumns(h, rows);
    setHeaders(merged.headers);
    setRawRows(merged.rows);
    setMapping(autoMapColumns(merged.headers, config.columns));
    setMapByOrder(false);
  }

  async function handleFile(file: File) {
    try {
      const { headers: h, rows } = await parseXlsxFile(file);
      applyParsed(h, rows);
    } catch {
      toast.error("Não foi possível ler o arquivo. Tente colar os dados manualmente.");
      setMethod("paste");
    }
  }

  function handlePasteText(text: string) {
    const { headers: h, rows } = parsePastedText(text);
    applyParsed(h, rows);
  }

  function goToMapping() {
    if (rawRows.length === 0) { toast.error("Nenhum dado detectado ainda."); return; }
    setStep("mapping");
  }

  function handleToggleMapByOrder(checked: boolean) {
    setMapByOrder(checked);
    setMapping(checked ? mapColumnsByOrder(headers, config.columns) : autoMapColumns(headers, config.columns));
  }

  function goToReview() {
    const missing = config.columns.filter((c) => c.required && (mapping[c.key] === null || mapping[c.key] === undefined));
    if (missing.length > 0) {
      toast.error(`Associe a coluna: ${missing.map((c) => c.label).join(", ")}`);
      return;
    }
    setPreview(buildPreview(config, headers, rawRows, mapping));
    setStep("review");
  }

  async function handleCommit() {
    if (!preview) return;
    const validRows = preview.rows.filter((r) => r.status !== "error").map((r) => r.data);
    if (validRows.length === 0) { toast.error("Não há linhas válidas para importar."); return; }
    setCommitting(true);
    try {
      const res = await onCommit(validRows);
      setResult(res);
      setStep("done");
      toast.success(`${res.inserted} registro(s) importado(s) com sucesso.`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao salvar os dados importados.");
    } finally {
      setCommitting(false);
    }
  }

  const stepIndex = IMPORT_STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Importar {config.title}</DialogTitle></DialogHeader>

        <WizardSteps steps={IMPORT_STEP_ORDER} labels={IMPORT_STEP_LABEL} currentIndex={stepIndex} />

        {step === "method" && (
          <div className="grid grid-cols-2 gap-4 py-4">
            <button onClick={() => { setMethod("file"); setStep("source"); }}
              className="flex flex-col items-center gap-3 border border-border rounded-xl p-8 hover:border-primary/50 hover:bg-muted/50 transition-colors">
              <FileUp className="h-8 w-8 text-primary" />
              <div className="text-center">
                <p className="font-medium">Enviar planilha (.xlsx)</p>
                <p className="text-xs text-muted-foreground mt-1">Recomendado — extração automática das colunas</p>
              </div>
            </button>
            <button onClick={() => { setMethod("paste"); setStep("source"); }}
              className="flex flex-col items-center gap-3 border border-border rounded-xl p-8 hover:border-primary/50 hover:bg-muted/50 transition-colors">
              <PasteIcon className="h-8 w-8 text-primary" />
              <div className="text-center">
                <p className="font-medium">Colar dados do Excel</p>
                <p className="text-xs text-muted-foreground mt-1">Use se o upload do arquivo der erro</p>
              </div>
            </button>
          </div>
        )}

        {step === "source" && (
          <div className="space-y-4 py-2">
            {method === "file" ? <FileDropzone onFile={handleFile} /> : <PasteArea onChangeText={handlePasteText} />}
            {rawRows.length > 0 && (
              <p className="text-sm text-success flex items-center gap-1.5">
                <CheckCircle2 className="h-4 w-4" /> {rawRows.length} linha(s) e {headers.length} coluna(s) detectadas.
              </p>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("method")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={goToMapping} disabled={rawRows.length === 0}>Continuar <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {step === "mapping" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Associamos automaticamente as colunas pelo nome. Confira e ajuste se necessário.
            </p>

            <label className="flex items-start gap-3 text-sm border border-border rounded-lg p-3 bg-muted/30 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4"
                checked={mapByOrder}
                onChange={(e) => handleToggleMapByOrder(e.target.checked)}
              />
              <span className="flex items-start gap-2">
                <ListOrdered className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                <span>
                  <span className="font-medium">Mapear pela ordem das colunas</span>
                  <br />
                  <span className="text-muted-foreground text-xs">
                    Ignora os nomes de cabeçalho: a 1ª coluna do arquivo vira o 1º campo abaixo, a 2ª vira o 2º, e assim por diante.
                    Útil quando o cabeçalho vem diferente do esperado, mas a ordem das colunas é sempre a mesma.
                  </span>
                </span>
              </span>
            </label>

            <div className="grid grid-cols-2 gap-3 max-h-[40vh] overflow-auto pr-1">
              {config.columns.map((col) => (
                <div key={col.key} className="space-y-1.5">
                  <label className="text-xs font-medium flex items-center gap-1">
                    {col.label} {col.required && <span className="text-destructive">*</span>}
                  </label>
                  <Select
                    value={mapping[col.key] !== null && mapping[col.key] !== undefined ? String(mapping[col.key]) : "none"}
                    onValueChange={(v) => setMapping((m) => ({ ...m, [col.key]: v === "none" ? null : Number(v) }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Não mapeado" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">— Não mapeado —</SelectItem>
                      {headers.map((h, i) => <SelectItem key={i} value={String(i)}>{h || `Coluna ${i + 1}`}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("source")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={goToReview}>Revisar dados <ArrowRight className="h-4 w-4" /></Button>
            </div>
          </div>
        )}

        {step === "review" && preview && (
          <div className="space-y-4 py-2">
            <div className="flex gap-4 text-sm">
              <span>Total: <strong>{preview.totalRows}</strong></span>
              <span className="text-success">Válidas: <strong>{preview.validRows}</strong></span>
              <span className="text-destructive">Com erro: <strong>{preview.errorRows}</strong></span>
            </div>
            <DataPreviewTable columns={config.columns.map((c) => ({ key: c.key, label: c.label }))} rows={preview.rows} />
            {preview.errorRows > 0 && (
              <p className="text-xs text-muted-foreground">
                Linhas com erro (em vermelho) serão ignoradas na importação. Corrija a planilha de origem e reenvie se quiser incluí-las.
              </p>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("mapping")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={handleCommit} disabled={committing}>
                {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Importar {preview.validRows} registro(s)
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="font-medium">{result.inserted} registro(s) importado(s) com sucesso.</p>
            <Button onClick={() => handleClose(false)}>Concluir</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// CategoriaImportWizard — Comparativo por Categoria (Relatório 2)
// ═════════════════════════════════════════════════════════════════════════

type CategoriaStep = "method" | "source" | "review" | "done";
const CATEGORIA_STEP_ORDER: CategoriaStep[] = ["method", "source", "review", "done"];
const CATEGORIA_STEP_LABEL: Record<CategoriaStep, string> = { method: "Método", source: "Dados", review: "Revisão", done: "Concluído" };

export function CategoriaImportWizard({
  open, onOpenChange, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (rows: ParsedCategoriaRow[]) => Promise<{ inserted: number }>;
}) {
  const [step, setStep] = useState<CategoriaStep>("method");
  const [method, setMethod] = useState<SourceMethod | null>(null);
  const [parsed, setParsed] = useState<{ rows: ParsedCategoriaRow[]; warnings: string[] } | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number } | null>(null);

  function reset() { setStep("method"); setMethod(null); setParsed(null); setResult(null); }
  function handleClose(next: boolean) { if (!next) reset(); onOpenChange(next); }

  function applyParsed(headers: string[], rows: string[][]) {
    const res = parseCategoriaGrid(headers, rows);
    setParsed(res);
    res.warnings.forEach((w) => toast.warning(w));
    setStep("review");
  }

  async function handleFile(file: File) {
    try {
      const { headers, rows } = await parseXlsxFile(file);
      applyParsed(headers, rows);
    } catch {
      toast.error("Não foi possível ler o arquivo. Tente colar os dados manualmente.");
      setMethod("paste");
    }
  }
  function handlePasteText(text: string) {
    const { headers, rows } = parsePastedText(text);
    applyParsed(headers, rows);
  }

  async function handleCommit() {
    if (!parsed || parsed.rows.length === 0) { toast.error("Nenhum dado válido para importar."); return; }
    setCommitting(true);
    try {
      const res = await onCommit(parsed.rows);
      setResult(res);
      setStep("done");
      toast.success(`${res.inserted} registro(s) importado(s).`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar.");
    } finally {
      setCommitting(false);
    }
  }

  const stepIndex = CATEGORIA_STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Importar Comparativo por Categoria (Relatório 2)</DialogTitle></DialogHeader>

        <WizardSteps steps={CATEGORIA_STEP_ORDER} labels={CATEGORIA_STEP_LABEL} currentIndex={stepIndex} />

        {step === "method" && (
          <div className="grid grid-cols-2 gap-4 py-4">
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
        )}

        {step === "source" && (
          <div className="space-y-4 py-2">
            {method === "file" ? <FileDropzone onFile={handleFile} /> : <PasteArea onChangeText={handlePasteText} />}
            <div className="flex justify-start pt-2">
              <Button variant="outline" onClick={() => setStep("method")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
            </div>
          </div>
        )}

        {step === "review" && parsed && (
          <div className="space-y-4 py-2">
            <p className="text-sm">
              <strong>{parsed.rows.length}</strong> registro(s) (cor × tributo × ponto × ano) serão importados.
            </p>
            {parsed.warnings.length > 0 && (
              <ul className="text-xs text-warning space-y-1">
                {parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("source")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={handleCommit} disabled={committing || parsed.rows.length === 0}>
                {committing ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Importar {parsed.rows.length} registro(s)
              </Button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <CheckCircle2 className="h-10 w-10 text-success" />
            <p className="font-medium">{result.inserted} registro(s) importado(s) com sucesso.</p>
            <Button onClick={() => handleClose(false)}>Concluir</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ═════════════════════════════════════════════════════════════════════════
// PontoImportWizard — importação individual (1 arquivo/paste = 1 ponto)
// ═════════════════════════════════════════════════════════════════════════

type PontoStep = "method" | "source" | "review" | "done";
const PONTO_STEP_ORDER: PontoStep[] = ["method", "source", "review", "done"];
const PONTO_STEP_LABEL: Record<PontoStep, string> = { method: "Método", source: "Dados", review: "Revisão", done: "Concluído" };

export function PontoImportWizard({
  open, onOpenChange, title, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onCommit: (rows: ParsedPontoMonthlyRow[]) => Promise<{ inserted: number; pointName: string }>;
}) {
  const [step, setStep] = useState<PontoStep>("method");
  const [method, setMethod] = useState<SourceMethod | null>(null);
  const [pointName, setPointName] = useState("");
  const [parsed, setParsed] = useState<ParsePontoMatrixResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [result, setResult] = useState<{ inserted: number; pointName: string } | null>(null);

  function reset() {
    setStep("method"); setMethod(null); setPointName(""); setParsed(null); setResult(null);
  }
  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  function applyGrid(grid: string[][]) {
    const res = parsePontoMatrix(grid, pointName || undefined);
    setParsed(res);
    res.warnings.forEach((w) => toast.warning(w));
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
    if (!parsed || parsed.rows.length === 0 || parsed.externalPointId === null) {
      toast.error("Não foi possível identificar o ID_PONTO. Confira os dados colados.");
      return;
    }
    setCommitting(true);
    try {
      const res = await onCommit(parsed.rows);
      setResult(res);
      setStep("done");
      toast.success(`${res.inserted} valor(es) importado(s) para "${res.pointName}".`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erro ao importar os dados do ponto.");
    } finally {
      setCommitting(false);
    }
  }

  const stepIndex = PONTO_STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

        <WizardSteps steps={PONTO_STEP_ORDER} labels={PONTO_STEP_LABEL} currentIndex={stepIndex} />

        {step === "method" && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Nome do ponto (opcional — usado só na primeira importação deste ID_PONTO)</Label>
              <Input value={pointName} onChange={(e) => setPointName(e.target.value)} placeholder='ex: "Fretes e Carretos"' />
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
              Selecione o bloco a partir da linha <strong>ID_TRIBUTO</strong> até a última linha de valores
              (incluindo a coluna com "P"/"C").
            </p>
            {method === "file" ? <FileDropzone onFile={handleFile} /> : <PasteArea onChangeText={handlePasteText} />}
            <div className="flex justify-start pt-2">
              <Button variant="outline" onClick={() => setStep("method")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
            </div>
          </div>
        )}

        {step === "review" && parsed && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="border border-border rounded-lg p-3">
                <p className="text-xs text-muted-foreground">ID_PONTO detectado</p>
                <p className="font-medium">{parsed.externalPointId ?? "— não encontrado —"}</p>
              </div>
              <div className="border border-border rounded-lg p-3">
                <p className="text-xs text-muted-foreground">ID_TRIBUTO detectado</p>
                <p className="font-medium">{parsed.externalTaxId ?? "—"}</p>
              </div>
            </div>
            <p className="text-sm">
              <strong>{parsed.rows.length}</strong> valor(es) mensais serão importados
              (PIS: {parsed.rows.filter((r) => r.contribution === "PIS").length},
              {" "}COFINS: {parsed.rows.filter((r) => r.contribution === "COFINS").length}).
            </p>
            {parsed.warnings.length > 0 && (
              <ul className="text-xs text-warning space-y-1">
                {parsed.warnings.map((w, i) => <li key={i}>⚠ {w}</li>)}
              </ul>
            )}
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("source")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={handleCommit} disabled={committing || parsed.rows.length === 0}>
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
// PontoMultiImportWizard — importação em lote (N arquivos = N pontos)
// ═════════════════════════════════════════════════════════════════════════

type PontoMultiStep = "source" | "review" | "importing" | "done";
const PONTO_MULTI_STEP_ORDER: PontoMultiStep[] = ["source", "review", "importing", "done"];
const PONTO_MULTI_STEP_LABEL: Record<PontoMultiStep, string> = {
  source: "Arquivos", review: "Revisão", importing: "Importando", done: "Concluído",
};

interface ParsedGroup {
  key: string;
  fileName: string;
  externalPointId: number | null;
  externalTaxId: number | null;
  rows: ParsedPontoMonthlyRow[];
  warnings: string[];
  name: string;
}

interface CommitOutcome {
  key: string;
  fileName: string;
  pointName: string;
  inserted: number;
  error?: string;
}

export function PontoMultiImportWizard({
  open, onOpenChange, title, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onCommit: (rows: ParsedPontoMonthlyRow[]) => Promise<{ inserted: number; pointName: string }>;
}) {
  const [step, setStep] = useState<PontoMultiStep>("source");
  const [files, setFiles] = useState<File[]>([]);
  const [parsing, setParsing] = useState(false);
  const [groups, setGroups] = useState<ParsedGroup[]>([]);
  const [results, setResults] = useState<CommitOutcome[]>([]);

  function reset() {
    setStep("source");
    setFiles([]);
    setParsing(false);
    setGroups([]);
    setResults([]);
  }
  function handleClose(next: boolean) {
    if (!next) reset();
    onOpenChange(next);
  }

  async function handleParseAll() {
    if (files.length === 0) {
      toast.error("Selecione ao menos uma planilha.");
      return;
    }
    setParsing(true);
    const nextGroups: ParsedGroup[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const existingName = groups.find((g) => g.fileName === file.name)?.name ?? "";
      try {
        const grid = await parseXlsxRawMatrix(file);
        const res = parsePontoMatrix(grid);
        res.warnings.forEach((w) => toast.warning(`${file.name}: ${w}`));
        nextGroups.push({
          key: `${file.name}_${i}`,
          fileName: file.name,
          externalPointId: res.externalPointId,
          externalTaxId: res.externalTaxId,
          rows: res.rows,
          warnings: res.warnings,
          name: existingName,
        });
      } catch {
        nextGroups.push({
          key: `${file.name}_${i}`,
          fileName: file.name,
          externalPointId: null,
          externalTaxId: null,
          rows: [],
          warnings: ["Não foi possível ler este arquivo."],
          name: existingName,
        });
      }
    }
    setGroups(nextGroups);
    setParsing(false);
    setStep("review");
  }

  function updateGroupName(key: string, name: string) {
    setGroups((gs) => gs.map((g) => (g.key === key ? { ...g, name } : g)));
  }

  const validGroups = groups.filter((g) => g.externalPointId !== null && g.rows.length > 0);
  const invalidGroups = groups.filter((g) => g.externalPointId === null || g.rows.length === 0);

  async function handleCommitAll() {
    setStep("importing");
    const outcomes: CommitOutcome[] = [];

    for (const g of invalidGroups) {
      outcomes.push({
        key: g.key, fileName: g.fileName, pointName: g.name,
        inserted: 0, error: "Ignorado — ID_PONTO não identificado ou sem valores.",
      });
    }

    for (const g of validGroups) {
      const rowsToSend = g.rows.map((r) => ({ ...r, point_name: g.name.trim() || null }));
      try {
        const res = await onCommit(rowsToSend);
        outcomes.push({ key: g.key, fileName: g.fileName, pointName: res.pointName, inserted: res.inserted });
      } catch (err) {
        outcomes.push({
          key: g.key, fileName: g.fileName, pointName: g.name,
          inserted: 0, error: err instanceof Error ? err.message : "Erro ao importar.",
        });
      }
    }

    setResults(outcomes);
    setStep("done");

    const totalInserted = outcomes.reduce((s, o) => s + o.inserted, 0);
    const errorCount = outcomes.filter((o) => o.error).length;
    if (errorCount === 0) {
      toast.success(`${totalInserted} valor(es) importado(s) em ${outcomes.length} ponto(s).`);
    } else {
      toast.warning(`Importação concluída com ${errorCount} erro/aviso(s). Confira o resumo.`);
    }
  }

  const stepIndex = PONTO_MULTI_STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>{title} — importação em lote</DialogTitle></DialogHeader>

        <WizardSteps steps={PONTO_MULTI_STEP_ORDER} labels={PONTO_MULTI_STEP_LABEL} currentIndex={stepIndex} />

        {step === "source" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Selecione várias planilhas .xlsx de uma vez — cada arquivo deve corresponder a um único
              ID_PONTO (mesmo formato do "Importar ponto" individual, a partir da linha ID_TRIBUTO).
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
              <strong>{validGroups.length}</strong> ponto(s) prontos para importar
              {invalidGroups.length > 0 && (
                <span className="text-warning"> · {invalidGroups.length} arquivo(s) com problema (serão ignorados)</span>
              )}
              . Ajuste o nome de cada ponto abaixo, se desejar.
            </p>

            <div className="border border-border rounded-lg overflow-auto max-h-[45vh]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>ID_PONTO</TableHead>
                    <TableHead>ID_TRIBUTO</TableHead>
                    <TableHead>Valores</TableHead>
                    <TableHead className="w-64">Nome do ponto</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {groups.map((g) => {
                    const invalid = g.externalPointId === null || g.rows.length === 0;
                    return (
                      <TableRow key={g.key} className={invalid ? "bg-destructive/5" : undefined}>
                        <TableCell className="text-sm max-w-[200px] truncate" title={g.fileName}>
                          {g.fileName}
                        </TableCell>
                        <TableCell className="text-sm">
                          {g.externalPointId ?? (
                            <Badge variant="destructive" title={g.warnings.join("; ")}>
                              <AlertTriangle className="h-3 w-3 mr-1" /> não identificado
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell className="text-sm">{g.externalTaxId ?? "—"}</TableCell>
                        <TableCell className="text-sm">{g.rows.length}</TableCell>
                        <TableCell>
                          <Input
                            value={g.name}
                            onChange={(e) => updateGroupName(g.key, e.target.value)}
                            placeholder='ex: "Fretes e Carretos"'
                            disabled={invalid}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
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
            <div className="border border-border rounded-lg overflow-auto max-h-[45vh]">
              <Table>
                <TableHeader className="sticky top-0 bg-card z-10">
                  <TableRow>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Ponto</TableHead>
                    <TableHead>Valores importados</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {results.map((r) => (
                    <TableRow key={r.key} className={r.error ? "bg-destructive/5" : undefined}>
                      <TableCell className="text-sm max-w-[200px] truncate" title={r.fileName}>{r.fileName}</TableCell>
                      <TableCell className="text-sm">{r.pointName || "—"}</TableCell>
                      <TableCell className="text-sm">{r.inserted}</TableCell>
                      <TableCell className="text-sm">
                        {r.error ? (
                          <Badge variant="destructive" title={r.error}>Erro</Badge>
                        ) : (
                          <Badge variant="success">OK</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
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
// IdentificationImportModal — identificação do job (Relatório 1)
// ═════════════════════════════════════════════════════════════════════════

type IdentificationStep = "method" | "source" | "review";
const IDENTIFICATION_STEP_ORDER: IdentificationStep[] = ["method", "source", "review"];
const IDENTIFICATION_STEP_LABEL: Record<IdentificationStep, string> = { method: "Método", source: "Dados", review: "Confirmar" };

export function IdentificationImportModal({
  open, onOpenChange, onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (data: ParsedJobIdentification) => void;
}) {
  const [step, setStep] = useState<IdentificationStep>("method");
  const [method, setMethod] = useState<SourceMethod | null>(null);
  const [parsed, setParsed] = useState<ParsedJobIdentification | null>(null);

  function reset() { setStep("method"); setMethod(null); setParsed(null); }
  function handleClose(next: boolean) { if (!next) reset(); onOpenChange(next); }

  function applyParsed(headers: string[], rows: string[][]) {
    const res = parseJobIdentification(headers, rows);
    if (!res) { toast.error("Nenhuma linha de dados encontrada."); return; }
    setParsed(res);
    setStep("review");
  }

  async function handleFile(file: File) {
    try {
      const { headers, rows } = await parseXlsxFile(file);
      applyParsed(headers, rows);
    } catch {
      toast.error("Não foi possível ler o arquivo. Tente colar os dados manualmente.");
      setMethod("paste");
    }
  }
  function handlePasteText(text: string) {
    const { headers, rows } = parsePastedText(text);
    applyParsed(headers, rows);
  }

  function handleConfirm() {
    if (!parsed) return;
    onApply(parsed);
    toast.success("Dados de identificação aplicados ao formulário.");
    handleClose(false);
  }

  const stepIndex = IDENTIFICATION_STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Importar identificação (Relatório 1)</DialogTitle></DialogHeader>

        <WizardSteps steps={IDENTIFICATION_STEP_ORDER} labels={IDENTIFICATION_STEP_LABEL} currentIndex={stepIndex} />

        {step === "method" && (
          <div className="grid grid-cols-2 gap-4 py-4">
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
        )}

        {step === "source" && (
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Selecione o cabeçalho e a linha de dados do Relatório 1 (colunas JOB, NOME, NOME PRODUTO,
              NOME SUBPRODUTO, REGIME DE TRIBUTAÇÃO — as demais colunas são ignoradas aqui).
            </p>
            {method === "file" ? <FileDropzone onFile={handleFile} /> : <PasteArea onChangeText={handlePasteText} />}
            <div className="flex justify-start pt-2">
              <Button variant="outline" onClick={() => setStep("method")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
            </div>
          </div>
        )}

        {step === "review" && parsed && (
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <IdentificationField label="Nº do Job" value={parsed.job_number} />
              <IdentificationField label="Cliente" value={parsed.company_name} />
              <IdentificationField label="Segmento" value={parsed.segment} />
              <IdentificationField label="Regime tributário" value={parsed.tax_regime} />
            </div>
            <p className="text-xs text-muted-foreground">
              Campos não encontrados na planilha ficam em branco e podem ser preenchidos manualmente.
              Isso não altera automaticamente o cadastro do cliente — só os campos deste formulário.
            </p>
            <div className="flex justify-between pt-2">
              <Button variant="outline" onClick={() => setStep("source")}><ArrowLeft className="h-4 w-4" /> Voltar</Button>
              <Button onClick={handleConfirm}>Aplicar ao formulário</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function IdentificationField({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value ?? "— não encontrado —"}</p>
    </div>
  );
}