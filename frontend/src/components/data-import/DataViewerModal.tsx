import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DataPreviewTable } from "./DataPreviewTable";
import type { ImportTableConfig } from "@/lib/import/importConfigs";

export function DataViewerModal<T extends Record<string, unknown>>({
  config, queryKey, fetcher, triggerLabel = "Visualizar dados",
}: {
  config: ImportTableConfig;
  queryKey: unknown[];
  fetcher: () => Promise<T[]>;
  triggerLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data = [], isLoading } = useQuery({ queryKey, queryFn: fetcher, enabled: open });

  const rows = useMemo(
    () => data.map((record, rowIndex) => ({ rowIndex, status: "ok" as const, messages: [], data: record })),
    [data]
  );

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Eye className="h-4 w-4" /> {triggerLabel}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>{config.title} — {data.length} registro{data.length === 1 ? "" : "s"}</DialogTitle>
          </DialogHeader>
          {isLoading ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Carregando…</p>
          ) : data.length === 0 ? (
            <p className="text-sm text-muted-foreground py-6 text-center">Nenhum dado importado ainda.</p>
          ) : (
            <DataPreviewTable columns={config.columns.map((c) => ({ key: c.key, label: c.label }))} rows={rows} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}