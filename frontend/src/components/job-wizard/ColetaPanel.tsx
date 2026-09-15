//components/job-wizard/ColetaPanel.tsx

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileUp, Trash2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import {
  perdcompApi, darfApi, spedM400Api, spedM610Api, pontosAdmApi, pontosFtxApi, pontosIpiApi, pontosIrCsllApi, pontosInssApi,
} from "@/lib/api";
import { ImportWizard, PontoImportWizard, PontoMultiImportWizard } from "@/components/data-import/ImportWizards";
import { IpiPontoImportWizard, IpiMultiImportWizard, IrCsllImportWizard, InssImportWizard } from "@/components/data-import/IpiIrCsllWizards";
import { DataViewerModal, GenericDataViewerModal } from "@/components/data-import/DataViewerModal";
import { PERDCOMP_CONFIG, DARF_CONFIG, M400_CONFIG, M610_CONFIG } from "@/lib/import/importConfigs";
import type { ImportTableConfig } from "@/lib/import/importConfigs";
import type { ParsedPontoMonthlyRow } from "@/lib/import/customParsers";
import type { IrCsllResolvedRow, InssResolvedRow } from "@/components/data-import/IpiIrCsllWizards";

const PONTO_VIEW_COLUMNS = [
  { key: "point_name", label: "Ponto" },
  { key: "reference_month", label: "Mês" },
  { key: "contribution", label: "Tributo" },
  { key: "value", label: "Valor" },
];

const IPI_VIEW_COLUMNS = [
  { key: "point_name", label: "Ponto" },
  { key: "reference_month", label: "Mês" },
  { key: "value", label: "Valor" },
];

const IRCSLL_VIEW_COLUMNS = [
  { key: "point_name", label: "Ponto" },
  { key: "reference_year", label: "Ano" },
  { key: "tax_sub_type", label: "IRPJ/CSLL" },
  { key: "value", label: "Valor" },
];

const INSS_VIEW_COLUMNS = [
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

// ─── Cards de Pontos ADM / FTX (PIS/COFINS, matriz com ID_PONTO) ────────────

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
        <p className="text-xs text-muted-foreground">
          Nome{category === "FTX" && " e cor"} de cada ponto vêm do catálogo global (Administração → Pontos).
          Se o ID_PONTO já existir na plataforma, os valores deste job são associados a ele automaticamente.
        </p>
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

// ─── Card de Pontos ADM IPI (sem ID_PONTO — casa por nome) ─────────────────

function IpiCard({ jobId }: { jobId: number }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [multiWizardOpen, setMultiWizardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["pontos-ipi", jobId];
  const { data = [] } = useQuery({ queryKey, queryFn: () => pontosIpiApi.list(jobId) });

  const distinctPoints = new Set(data.map((r) => r.point_name)).size;

  const clearMutation = useMutation({
    mutationFn: () => pontosIpiApi.clearAll(jobId),
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
            <p className="font-medium">Importar pontos ADM IPI</p>
            <p className="text-sm text-muted-foreground">Valores mensais de crédito de IPI por ponto (sem separação PIS/COFINS).</p>
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
          <GenericDataViewerModal title="Pontos ADM IPI" queryKey={queryKey} fetcher={() => pontosIpiApi.list(jobId)} columns={IPI_VIEW_COLUMNS} />
          {data.length > 0 && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" /> Desimportar tudo
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          A planilha de IPI não traz ID_PONTO — o nome do ponto vem do título da aba "Comparativo" e é casado
          com o catálogo global de pontos IPI (Administração → Pontos).
        </p>
      </CardContent>

      <IpiPontoImportWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCommit={async (pointId, pointName, rows) => {
          const res = await pontosIpiApi.bulkImport(jobId, pointId, rows);
          queryClient.invalidateQueries({ queryKey });
          queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
          return res;
        }}
      />
      <IpiMultiImportWizard
        open={multiWizardOpen}
        onOpenChange={setMultiWizardOpen}
        onCommit={async (pointId, pointName, rows) => {
          const res = await pontosIpiApi.bulkImport(jobId, pointId, rows);
          queryClient.invalidateQueries({ queryKey });
          queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
          return res;
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Desimportar Pontos ADM IPI?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove permanentemente todos os {data.length} valor(es) mensais de {distinctPoints} ponto(s) de IPI
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

// ─── Card de Pontos IR/CSLL (1 arquivo = N pontos, anual) ──────────────────

function IrCsllCard({ jobId }: { jobId: number }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["pontos-ir-csll", jobId];
  const { data = [] } = useQuery({ queryKey, queryFn: () => pontosIrCsllApi.list(jobId) });

  const distinctPoints = new Set(data.map((r) => r.point_name)).size;

  const clearMutation = useMutation({
    mutationFn: () => pontosIrCsllApi.clearAll(jobId),
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
            <p className="font-medium">Importar Pontos IR/CSLL</p>
            <p className="text-sm text-muted-foreground">Valores anuais de crédito de IRPJ/CSLL, por ponto — um único arquivo cobre todos os pontos do job.</p>
          </div>
          <Badge variant={data.length > 0 ? "success" : "muted"}>
            {distinctPoints} ponto{distinctPoints === 1 ? "" : "s"} · {data.length} valor(es)
          </Badge>
        </div>
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button size="sm" onClick={() => setWizardOpen(true)}><FileUp className="h-4 w-4" /> Importar planilha</Button>
          <GenericDataViewerModal title="Pontos IR/CSLL" queryKey={queryKey} fetcher={() => pontosIrCsllApi.list(jobId)} columns={IRCSLL_VIEW_COLUMNS} />
          {data.length > 0 && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" /> Desimportar tudo
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Os pontos são lidos da aba "Totais" da planilha de IR/CSLL do job e casados com o catálogo global
          (Administração → Pontos) pelo nome.
        </p>
      </CardContent>

      <IrCsllImportWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCommit={async (rows: IrCsllResolvedRow[]) => {
          const res = await pontosIrCsllApi.bulkImport(jobId, rows);
          queryClient.invalidateQueries({ queryKey });
          queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
          return res;
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Desimportar Pontos IR/CSLL?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove permanentemente todos os {data.length} valor(es) anuais de {distinctPoints} ponto(s) de
            IRPJ/CSLL para este job. Ação registrada no histórico de auditoria.
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

// ─── Card de Pontos INSS (1 arquivo = N pontos, anual, sem split) ──────────

function InssCard({ jobId }: { jobId: number }) {
  const [wizardOpen, setWizardOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const queryClient = useQueryClient();
  const queryKey = ["pontos-inss", jobId];
  const { data = [] } = useQuery({ queryKey, queryFn: () => pontosInssApi.list(jobId) });

  const distinctPoints = new Set(data.map((r) => r.point_name)).size;

  const clearMutation = useMutation({
    mutationFn: () => pontosInssApi.clearAll(jobId),
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
            <p className="font-medium">Importar Pontos INSS</p>
            <p className="text-sm text-muted-foreground">Valores anuais de crédito de INSS, por ponto — um único arquivo cobre todos os pontos do job.</p>
          </div>
          <Badge variant={data.length > 0 ? "success" : "muted"}>
            {distinctPoints} ponto{distinctPoints === 1 ? "" : "s"} · {data.length} valor(es)
          </Badge>
        </div>
        <div className="flex items-center gap-2 pt-1 flex-wrap">
          <Button size="sm" onClick={() => setWizardOpen(true)}><FileUp className="h-4 w-4" /> Importar planilha</Button>
          <GenericDataViewerModal title="Pontos INSS" queryKey={queryKey} fetcher={() => pontosInssApi.list(jobId)} columns={INSS_VIEW_COLUMNS} />
          {data.length > 0 && (
            <Button size="sm" variant="ghost" className="text-destructive hover:text-destructive hover:bg-destructive/10"
              onClick={() => setConfirmOpen(true)}>
              <Trash2 className="h-4 w-4" /> Desimportar tudo
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Os pontos são lidos da aba "Totais" da planilha de INSS do job e casados com o catálogo global
          (Administração → Pontos) pelo nome — com respaldo opcional por ordem, já que INSS ainda não tem
          um ID_PONTO de origem confiável (ver toggle dentro do wizard).
        </p>
      </CardContent>

      <InssImportWizard
        open={wizardOpen}
        onOpenChange={setWizardOpen}
        onCommit={async (rows: InssResolvedRow[]) => {
          const res = await pontosInssApi.bulkImport(jobId, rows);
          queryClient.invalidateQueries({ queryKey });
          queryClient.invalidateQueries({ queryKey: ["point-definitions"] });
          return res;
        }}
      />

      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Desimportar Pontos INSS?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            Remove permanentemente todos os {data.length} valor(es) anuais de {distinctPoints} ponto(s) de
            INSS para este job. Ação registrada no histórico de auditoria.
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
        <p className="text-sm font-medium">Pontos de crédito — PIS/COFINS</p>
        <p className="text-sm text-muted-foreground">
          Cada importação corresponde a um único ponto (identificado pelo ID_PONTO da planilha de origem).
          Se o ID já existir na plataforma, os valores deste job são anexados a ele; caso contrário, um novo
          ponto é criado sem nome/cor — que pode ser preenchido em Administração → Pontos.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <PontoCard
          jobId={jobId} category="ADM" title="Pontos ADM PIS/COFINS"
          description="Valores mensais de PIS/COFINS por ponto administrativo."
          api={pontosAdmApi}
        />
        <PontoCard
          jobId={jobId} category="FTX" title="Pontos FTX PIS/COFINS"
          description="Valores mensais de PIS/COFINS por ponto FINTAX, com cor de risco."
          api={pontosFtxApi}
        />
      </div>

      <div>
        <p className="text-sm font-medium">Pontos de crédito — outros tributos</p>
        <p className="text-sm text-muted-foreground">
          IPI e IR/CSLL usam o mesmo catálogo global de pontos (Administração → Pontos), mas com formatos de
          planilha e periodicidade próprios (IPI é mensal sem split; IR/CSLL é anual com split IRPJ/CSLL).
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <IpiCard jobId={jobId} />
        <IrCsllCard jobId={jobId} />
        <InssCard jobId={jobId} />
      </div>
    </div>
  );
}