import { useMemo, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from "@/components/ui/table";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import type { ImportValidationRow, ImportRowStatus } from "@/lib/import/importConfigs";

const PAGE_SIZE = 25;

export function DataPreviewTable({
  columns, rows,
}: {
  columns: { key: string; label: string }[];
  rows: ImportValidationRow[];
}) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<ImportRowStatus | "all">("all");
  const [columnFilters, setColumnFilters] = useState<Record<string, string>>({});
  const [page, setPage] = useState(0);

  const filterableColumns = useMemo(
    () => columns.filter((col) => {
      const values = new Set(rows.map((r) => String(r.data[col.key] ?? "")));
      return values.size > 1 && values.size <= 8;
    }),
    [columns, rows]
  );

  const filtered = useMemo(() => rows.filter((row) => {
    if (statusFilter !== "all" && row.status !== statusFilter) return false;
    for (const [key, value] of Object.entries(columnFilters)) {
      if (value && value !== "all" && String(row.data[key] ?? "") !== value) return false;
    }
    if (search) {
      const haystack = Object.values(row.data).join(" ").toLowerCase();
      if (!haystack.includes(search.toLowerCase())) return false;
    }
    return true;
  }), [rows, search, statusFilter, columnFilters]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Buscar em todas as colunas…"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v as ImportRowStatus | "all"); setPage(0); }}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todas as linhas</SelectItem>
            <SelectItem value="ok">✅ Sem erro</SelectItem>
            <SelectItem value="warning">⚠️ Alertas</SelectItem>
            <SelectItem value="error">❌ Erros</SelectItem>
          </SelectContent>
        </Select>
        {filterableColumns.map((col) => {
          const uniqueValues = Array.from(new Set(rows.map((r) => String(r.data[col.key] ?? "")))).filter(Boolean);
          return (
            <Select key={col.key} value={columnFilters[col.key] ?? "all"}
              onValueChange={(v) => { setColumnFilters((f) => ({ ...f, [col.key]: v })); setPage(0); }}>
              <SelectTrigger className="w-40"><SelectValue placeholder={col.label} /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{col.label}: todos</SelectItem>
                {uniqueValues.map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
              </SelectContent>
            </Select>
          );
        })}
      </div>

      <div className="border border-border rounded-lg overflow-auto max-h-[50vh]">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10">
            <TableRow>
              <TableHead className="w-10">#</TableHead>
              <TableHead className="w-16">Status</TableHead>
              {columns.map((col) => <TableHead key={col.key}>{col.label}</TableHead>)}
            </TableRow>
          </TableHeader>
          <TableBody>
            {pageRows.map((row) => (
              <TableRow key={row.rowIndex} className={
                row.status === "error" ? "bg-destructive/5" : row.status === "warning" ? "bg-warning/5" : undefined
              }>
                <TableCell className="text-xs text-muted-foreground">{row.rowIndex + 1}</TableCell>
                <TableCell>
                  {row.status === "ok" && <Badge variant="success">OK</Badge>}
                  {row.status === "warning" && <Badge variant="warning" title={row.messages.join("; ")}>Alerta</Badge>}
                  {row.status === "error" && <Badge variant="destructive" title={row.messages.join("; ")}>Erro</Badge>}
                </TableCell>
                {columns.map((col) => (
                  <TableCell key={col.key} className="text-sm whitespace-nowrap">
                    {formatCell(row.data[col.key])}
                  </TableCell>
                ))}
              </TableRow>
            ))}
            {pageRows.length === 0 && (
              <TableRow>
                <TableCell colSpan={columns.length + 2} className="text-center text-sm text-muted-foreground py-6">
                  Nenhum registro encontrado com esses filtros.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{filtered.length} de {rows.length} linhas</span>
        <div className="flex items-center gap-2">
          <button className="px-2 py-1 rounded hover:bg-muted disabled:opacity-40" disabled={page === 0} onClick={() => setPage((p) => p - 1)}>Anterior</button>
          <span>Página {page + 1} de {totalPages}</span>
          <button className="px-2 py-1 rounded hover:bg-muted disabled:opacity-40" disabled={page >= totalPages - 1} onClick={() => setPage((p) => p + 1)}>Próxima</button>
        </div>
      </div>
    </div>
  );
}

function formatCell(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return value.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return String(value);
}