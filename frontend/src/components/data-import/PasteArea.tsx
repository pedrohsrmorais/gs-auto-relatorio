import { useState } from "react";
import { ClipboardPaste } from "lucide-react";
import { Textarea } from "@/components/ui/textarea";

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