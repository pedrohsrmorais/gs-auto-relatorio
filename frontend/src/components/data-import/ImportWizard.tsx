import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileUp, ClipboardPaste as PasteIcon, ArrowLeft, ArrowRight, Loader2, ListOrdered } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { FileDropzone } from "./FileDropzone";
import { PasteArea } from "./PasteArea";
import { DataPreviewTable } from "./DataPreviewTable";
import {
  autoMapColumns, buildPreview, mapColumnsByOrder, parsePastedText, parseXlsxFile,
  preprocessCompositeDateColumns,
} from "@/lib/import/parseUtils";
import type { ImportPreviewResult, ImportTableConfig } from "@/lib/import/importConfigs";

type Method = "file" | "paste";
type Step = "method" | "source" | "mapping" | "review" | "done";

const STEP_ORDER: Step[] = ["method", "source", "mapping", "review", "done"];
const STEP_LABEL: Record<Step, string> = {
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
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method | null>(null);
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

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-4xl">
        <DialogHeader><DialogTitle>Importar {config.title}</DialogTitle></DialogHeader>

        <div className="flex items-center gap-2 text-xs mb-2 flex-wrap">
          {STEP_ORDER.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <span className={`h-6 w-6 rounded-full flex items-center justify-center border ${
                i < stepIndex ? "bg-success text-success-foreground border-success" :
                i === stepIndex ? "border-primary text-primary" : "border-border text-muted-foreground"
              }`}>
                {i < stepIndex ? <CheckCircle2 className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={i === stepIndex ? "font-medium" : "text-muted-foreground"}>{STEP_LABEL[s]}</span>
              {i < STEP_ORDER.length - 1 && <div className="w-6 h-px bg-border" />}
            </div>
          ))}
        </div>

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