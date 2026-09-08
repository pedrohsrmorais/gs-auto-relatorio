import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileUp, ClipboardPaste as PasteIcon, ArrowLeft, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDropzone } from "./FileDropzone";
import { PasteArea } from "./PasteArea";
import { parsePastedMatrix, parseXlsxRawMatrix } from "@/lib/import/parseUtils";
import { parsePontoMatrix, type ParsedPontoMonthlyRow, type ParsePontoMatrixResult } from "@/lib/import/pontoMatrixParser";

type Method = "file" | "paste";
type Step = "method" | "source" | "review" | "done";

const STEP_ORDER: Step[] = ["method", "source", "review", "done"];
const STEP_LABEL: Record<Step, string> = { method: "Método", source: "Dados", review: "Revisão", done: "Concluído" };

export function PontoImportWizard({
  open, onOpenChange, title, onCommit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  onCommit: (rows: ParsedPontoMonthlyRow[]) => Promise<{ inserted: number; pointName: string }>;
}) {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method | null>(null);
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

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-3xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>

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