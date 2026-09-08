import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileUp, ClipboardPaste as PasteIcon, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDropzone } from "./FileDropzone";
import { PasteArea } from "./PasteArea";
import { parsePastedText, parseXlsxFile } from "@/lib/import/parseUtils";
import { parseCategoriaGrid, type ParsedCategoriaRow } from "@/lib/import/categoriaParser";

type Method = "file" | "paste";
type Step = "method" | "source" | "review" | "done";
const STEP_ORDER: Step[] = ["method", "source", "review", "done"];
const STEP_LABEL: Record<Step, string> = { method: "Método", source: "Dados", review: "Revisão", done: "Concluído" };

export function CategoriaImportWizard({
  open, onOpenChange, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCommit: (rows: ParsedCategoriaRow[]) => Promise<{ inserted: number }>;
}) {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method | null>(null);
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

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Importar Comparativo por Categoria (Relatório 2)</DialogTitle></DialogHeader>

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