import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  perdcompApi, darfApi, spedM400Api, spedM610Api, pontosAdmApi, pontosFtxApi, ftxCategoriaApi,
} from "@/lib/api";
import { ImportWizard, PontoImportWizard, PontoMultiImportWizard, CategoriaImportWizard } from "@/components/data-import/ImportWizards";
import { DataViewerModal, GenericDataViewerModal } from "@/components/data-import/DataViewerModal";
import { PERDCOMP_CONFIG, DARF_CONFIG, M400_CONFIG, M610_CONFIG } from "@/lib/import/importConfigs";
import type { ImportTableConfig } from "@/lib/import/importConfigs";
import type { ParsedPontoMonthlyRow } from "@/lib/import/pontoMatrixParser";

const PONTO_VIEW_COLUMNS = [
  { key: "point_name", label: "Ponto" },
  { key: "reference_month", label: "Mês" },
  { key: "contribution", label: "Tributo" },
  { key: "value", label: "Valor" },
];

const CATEGORIA_VIEW_COLUMNS = [
  { key: "risk_color", label: "Cor" },
  { key: "tax_name", label: "Tributo" },
  { key: "point_name", label: "Ponto" },
  { key: "reference_year", label: "Ano" },
  { key: "value", label: "Valor" },
];

// ─── Fontes genéricas (PERDCOMP / DARF / M400 / M610) ──────────────────────

interface SourceDef {
  config: ImportTableConfig;
  queryKey: (jobId: number) => unknown[];
  list: (jobId: number) => Promise<Record<string, unknown>[]>;
  bulkImport: (jobId: number, rows: Record<string, unknown>[]) => Promise<{ inserted: number }>;
  clearAll: (jobId: number) => Promise<{ deleted: number }>;
}

const SOURCES: SourceDef[] = [
  {
    config: PERDCOMP_CONFIG,
    queryKey: (id) => ["perdcomps", id],
    list: (id) => perdcompApi.list(id).then((rows) => rows as unknown as Record<string, unknown>[]),
    bulkImport: (id, rows) => perdcompApi.bulkImport(id, rows),
    clearAll: (id) => perdcompApi.clearAll(id),
  },
  {
    config: DARF_CONFIG,
    queryKey: (id) => ["darf-entries", id],
    list: (id) => darfApi.list(id).then((rows) => rows as unknown as Record<string, unknown>[]),
    bulkImport: (id, rows) => darfApi.bulkImport(id, rows),
    clearAll: (id) => darfApi.clearAll(id),
  },
  {
    config: M400_CONFIG,
    queryKey: (id) => ["sped-m400", id],
    list: (id) => spedM400Api.list(id).then((rows) => rows as unknown as Record<string, unknown>[]),
    bulkImport: (id, rows) => spedM400Api.bulkImport(id, rows),
    clearAll: (id) => spedM400Api.clearAll(id),
  },
  {
    config: M610_CONFIG,
    queryKey: (id) => ["sped-m610", id],
    list: (id) => spedM610Api.list(id).then((rows) => rows as unknown as Record<string, unknown>[]),
    bulkImport: (id, rows) => spedM610Api.bulkImport(id, rows),
    clearAll: (id) => spedM610Api.clearAll(id),
  },
];

function SourceCard({ jobId, source }: { jobId: number; source: SourceDef }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = source.queryKey(jobId);
  const { data = [] } = useQuery({ queryKey, queryFn: () => source.list(jobId) });

  const clearMutation = useMutation({
    mutationFn: () => source.clearAll(jobId),
    onSuccess: (res) => {
      toast.success(`${res.deleted} registro(s) removido(s).`);
      queryClient.invalidateQueries({ queryKey });
      setConfirmOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao desimportar dados."),
  });

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium">{source.config.title}</p>
            <p className="text-sm text-muted-foreground">{source.config.description}</p>
          </div>
          <Badge variant={data.length > 0 ? "success" : "muted"}>
            {data.length} registro{data.length === 1 ? "" : "s"}
          </Badge>
        </div>
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button size="sm" onClick={() => setWizardOpen(true)}><FileUp className="h-4 w-4" /> Importar dados</Button>
          <DataViewerModal config={source.config} queryKey={queryKey} fetcher={() => source.list(jobId)} />
          {data.length > 0 && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" /> Desimportar
            </Button>
          )}
        </div>
      </CardContent>

      <ImportWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        config={source.config}
        onCommit={async (rows) => {
          const res = await source.bulkImport(jobId, rows);
          queryClient.invalidateQueries({ queryKey });
          return res;
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Desimportar {source.config.title}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove permanentemente os <strong>{data.length}</strong> registro(s) já importados desta tabela
            para este job. Ação registrada no histórico de auditoria.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending}>
              {clearMutation.isPending ? "Removendo…" : "Sim, desimportar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Cards de Pontos (ADM / FTX) ────────────────────────────────────────────

function PontoCard({
  jobId, category, title, description, api,
}: {
  jobId: number;
  category: "ADM" | "FTX";
  title: string;
  description: string;
  api: {
    list: (id: number) => Promise<Record<string, unknown>[]>;
    bulkImport: (id: number, rows: ParsedPontoMonthlyRow[]) => Promise<{ inserted: number; pointName: string }>;
    clearAll: (id: number) => Promise<{ deleted: number }>;
  };
}) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [multiWizardOpen, setMultiWizardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = [`pontos-${category.toLowerCase()}`, jobId];
  const { data = [] } = useQuery({ queryKey, queryFn: () => api.list(jobId) });

  const distinctPoints = new Set(data.map((r) => r.point_name)).size;

  const clearMutation = useMutation({
    mutationFn: () => api.clearAll(jobId),
    onSuccess: (res) => {
      toast.success(`${res.deleted} valor(es) removido(s).`);
      queryClient.invalidateQueries({ queryKey });
      setConfirmOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao desimportar."),
  });

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium">{title}</p>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
          <Badge variant={data.length > 0 ? "success" : "muted"}>
            {distinctPoints} ponto{distinctPoints === 1 ? "" : "s"} · {data.length} valor(es)
          </Badge>
        </div>
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button size="sm" onClick={() => setWizardOpen(true)}><FileUp className="h-4 w-4" /> Importar ponto</Button>
          <Button size="sm" variant="outline" onClick={() => setMultiWizardOpen(true)}>
            <FileUp className="h-4 w-4" /> Importar vários pontos
          </Button>
          <GenericDataViewerModal title={title} queryKey={queryKey} fetcher={() => api.list(jobId)} columns={PONTO_VIEW_COLUMNS} />
          {data.length > 0 && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" /> Desimportar tudo
            </Button>
          )}
        </div>
      </CardContent>

      <PontoImportWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        title={`Importar ${title}`}
        onCommit={async (rows) => {
          const res = await api.bulkImport(jobId, rows);
          queryClient.invalidateQueries({ queryKey });
          return res;
        }}
      />

      <PontoMultiImportWizard
        open={multiWizardOpen}
        onOpenChange={setMultiWizardOpen}
        title={title}
        onCommit={async (rows) => {
          const res = await api.bulkImport(jobId, rows);
          queryClient.invalidateQueries({ queryKey });
          return res;
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Desimportar {title}?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove permanentemente todos os {data.length} valor(es) mensais de {distinctPoints} ponto(s)
            desta categoria para este job. Ação registrada no histórico de auditoria.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending}>
              {clearMutation.isPending ? "Removendo…" : "Sim, desimportar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Card do Comparativo por Categoria (Relatório 2) ───────────────────────

function CategoriaCard({ jobId }: { jobId: number }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["ftx-categoria", jobId];
  const { data = [] } = useQuery({ queryKey, queryFn: () => ftxCategoriaApi.list(jobId) });

  const clearMutation = useMutation({
    mutationFn: () => ftxCategoriaApi.clearAll(jobId),
    onSuccess: (res) => {
      toast.success(`${res.deleted} registro(s) removido(s).`);
      queryClient.invalidateQueries({ queryKey });
      setConfirmOpen(false);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao desimportar."),
  });

  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <div className="flex items-start justify-between">
          <div>
            <p className="font-medium">Comparativo por Categoria (Relatório 2)</p>
            <p className="text-sm text-muted-foreground">PIS/COFINS por cor de risco (verde/amarelo/vermelho), ano a ano.</p>
          </div>
          <Badge variant={data.length > 0 ? "success" : "muted"}>{data.length} registro{data.length === 1 ? "" : "s"}</Badge>
        </div>
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button size="sm" onClick={() => setWizardOpen(true)}><FileUp className="h-4 w-4" /> Importar dados</Button>
          <GenericDataViewerModal
            title="Comparativo por Categoria"
            queryKey={queryKey}
            fetcher={() => ftxCategoriaApi.list(jobId)}
            columns={CATEGORIA_VIEW_COLUMNS}
          />
          {data.length > 0 && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" /> Desimportar
            </Button>
          )}
        </div>
      </CardContent>

      <CategoriaImportWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCommit={async (rows) => {
          const res = await ftxCategoriaApi.bulkImport(jobId, rows);
          queryClient.invalidateQueries({ queryKey });
          return res;
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Desimportar Comparativo por Categoria?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove permanentemente os {data.length} registro(s) já importados. Ação registrada no histórico de auditoria.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancelar</Button>
            <Button variant="destructive" onClick={() => clearMutation.mutate()} disabled={clearMutation.isPending}>
              {clearMutation.isPending ? "Removendo…" : "Sim, desimportar"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

// ─── Painel principal ───────────────────────────────────────────────────────

export function ColetaPanel({ jobId }: { jobId: number }) {
  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium">Coleta de dados</p>
        <p className="text-sm text-muted-foreground">
          Importe as planilhas de PER/DCOMP, DARF e SPED (M400/M610) referentes ao período do job.
          Envie o arquivo .xlsx original ou, se der erro, cole os dados copiados do Excel.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {SOURCES.map((s) => <SourceCard key={s.config.id} jobId={jobId} source={s} />)}
      </div>

      <div>
        <p className="text-sm font-medium">Pontos de crédito</p>
        <p className="text-sm text-muted-foreground">
          Cada importação corresponde a um único ponto (identificado pelo ID_PONTO da planilha de origem).
          Se o ID já existir no sistema, os valores são atualizados; caso contrário, um novo ponto é criado.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PontoCard
          jobId={jobId} category="ADM" title="Pontos ADM"
          description="Valores mensais de PIS/COFINS por ponto administrativo."
          api={pontosAdmApi}
        />
        <PontoCard
          jobId={jobId} category="FTX" title="Pontos FTX"
          description="Valores mensais de PIS/COFINS por ponto FINTAX."
          api={pontosFtxApi}
        />
      </div>

      <div>
        <p className="text-sm font-medium">Comparativo</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <CategoriaCard jobId={jobId} />
      </div>
    </div>
  );
}