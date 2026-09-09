import { useCallback, useState } from "react";
import { UploadCloud, FileSpreadsheet, X, ClipboardPaste } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

// ─── Single file dropzone (fluxo individual: Categoria, Ponto, Identificação) ─

export function FileDropzone({ onFile }: { onFile: (file: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);

  const handleFiles = useCallback((files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setFileName(file.name);
    onFile(file);
  }, [onFile]);

  return (
    <label
      onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
      className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors ${
        dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
      }`}
    >
      <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => handleFiles(e.target.files)} />
      {fileName ? (
        <>
          <FileSpreadsheet className="h-8 w-8 text-primary" />
          <p className="text-sm font-medium">{fileName}</p>
          <p className="text-xs text-muted-foreground">Clique ou arraste outro arquivo para substituir</p>
        </>
      ) : (
        <>
          <UploadCloud className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-medium">Arraste a planilha aqui ou clique para selecionar</p>
          <p className="text-xs text-muted-foreground">.xlsx, .xls ou .csv</p>
        </>
      )}
    </label>
  );
}

// ─── Multi file dropzone (fluxo em lote: Pontos ADM/FTX) ───────────────────

export function MultiFileDropzone({
  files, onFilesChange,
}: {
  files: File[];
  onFilesChange: (files: File[]) => void;
}) {
  const [dragging, setDragging] = useState(false);

  const addFiles = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return;
    const incoming = Array.from(list);
    const existingKeys = new Set(files.map((f) => `${f.name}_${f.size}`));
    const merged = [...files];
    for (const f of incoming) {
      const key = `${f.name}_${f.size}`;
      if (!existingKeys.has(key)) {
        merged.push(f);
        existingKeys.add(key);
      }
    }
    onFilesChange(merged);
  }, [files, onFilesChange]);

  function removeFile(index: number) {
    onFilesChange(files.filter((_, i) => i !== index));
  }

  return (
    <div className="space-y-3">
      <label
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
        className={`flex flex-col items-center justify-center gap-2 border-2 border-dashed rounded-xl p-10 cursor-pointer transition-colors ${
          dragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
        }`}
      >
        <input
          type="file"
          accept=".xlsx,.xls"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
        />
        <UploadCloud className="h-8 w-8 text-muted-foreground" />
        <p className="text-sm font-medium">Arraste várias planilhas aqui ou clique para selecionar</p>
        <p className="text-xs text-muted-foreground">.xlsx ou .xls — uma tabela (ID_PONTO) por arquivo</p>
      </label>

      {files.length > 0 && (
        <div className="border border-border rounded-lg divide-y divide-border max-h-56 overflow-auto">
          {files.map((f, i) => (
            <div key={`${f.name}_${f.size}_${i}`} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <span className="flex items-center gap-2 min-w-0">
                <FileSpreadsheet className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{f.name}</span>
              </span>
              <button
                type="button"
                onClick={() => removeFile(i)}
                className="text-muted-foreground hover:text-destructive shrink-0"
                aria-label={`Remover ${f.name}`}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Paste area (fluxo colar do Excel) ──────────────────────────────────────

export function PasteArea({ onChangeText }: { onChangeText: (text: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <ClipboardPaste className="h-4 w-4" />
        Selecione o intervalo no Excel (incluindo o cabeçalho), copie com Ctrl+C e cole abaixo com Ctrl+V.
      </div>
      <Textarea
        value={value}
        onChange={(e) => { setValue(e.target.value); onChangeText(e.target.value); }}
        placeholder="Cole aqui os dados copiados do Excel…"
        className="font-mono text-xs min-h-[200px]"
      />
    </div>
  );
}