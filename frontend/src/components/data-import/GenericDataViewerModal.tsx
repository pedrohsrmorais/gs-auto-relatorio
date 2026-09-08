import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataPreviewTable } from "./DataPreviewTable";

export function GenericDataViewerModal({
  title, queryKey, fetcher, columns,
}: {
  title: string;
  queryKey: unknown[];
  fetcher: () => Promise<Record<string, unknown>[]>;
  columns: { key: string; label: string }[];
}) {
  const [open, setOpen] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey, queryFn: fetcher, enabled: open });

  const rows = data.map((record, rowIndex) => ({ rowIndex, status: "ok" as const, messages: [], data: record }));

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Eye className="h-4 w-4" /> Visualizar dados
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader><DialogTitle>{title} — {data.length} registro{data.length === 1 ? "" : "s"}</DialogTitle></DialogHeader>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhum dado importado ainda.</p>
          ) : (
            <DataPreviewTable columns={columns} rows={rows} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}