import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, FileUp, ClipboardPaste as PasteIcon, ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FileDropzone } from "./FileDropzone";
import { PasteArea } from "./PasteArea";
import { parsePastedText, parseXlsxFile } from "@/lib/import/parseUtils";
import { parseJobIdentification, type ParsedJobIdentification } from "@/lib/import/identificationParser";

type Method = "file" | "paste";
type Step = "method" | "source" | "review";
const STEP_ORDER: Step[] = ["method", "source", "review"];
const STEP_LABEL: Record<Step, string> = { method: "Método", source: "Dados", review: "Confirmar" };

export function IdentificationImportModal({
  open, onOpenChange, onApply,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onApply: (data: ParsedJobIdentification) => void;
}) {
  const [step, setStep] = useState<Step>("method");
  const [method, setMethod] = useState<Method | null>(null);
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

  const stepIndex = STEP_ORDER.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle>Importar identificação (Relatório 1)</DialogTitle></DialogHeader>

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
              <Field label="Nº do Job" value={parsed.job_number} />
              <Field label="Cliente" value={parsed.company_name} />
              <Field label="Segmento" value={parsed.segment} />
              <Field label="Regime tributário" value={parsed.tax_regime} />
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

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="border border-border rounded-lg p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">{value ?? "— não encontrado —"}</p>
    </div>
  );
}