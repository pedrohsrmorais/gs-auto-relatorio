// routes/admin/logs.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Clock, AlertTriangle, CheckCircle2, FileDown, Upload,
  Trash2, RefreshCw, Calendar, Search, ChevronLeft, ChevronRight,
  TrendingUp, Users, BarChart3, ArrowRight,
} from "lucide-react";
import { logsApi } from "@/lib/api";
import type { AuditLog, ProductivityJob } from "@/lib/api";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

// ─── Route ────────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/admin/logs")({
  component: () => (
    <ProtectedRoute requireAdmin>
      <LogsPage />
    </ProtectedRoute>
  ),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Diferença em minutos entre dois timestamps ISO. Retorna null se inválido. */
function diffMinutes(a: string | null, b: string | null): number | null {
  if (!a || !b) return null;
  const diff = (new Date(b).getTime() - new Date(a).getTime()) / 60_000;
  return diff < 0 ? null : diff;
}

/** Formata duração em minutos como string legível. */
function fmtDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)}min`;
  if (minutes < 1440) return `${(minutes / 60).toFixed(1)}h`;
  return `${(minutes / 1440).toFixed(1)} dias`;
}

/** Classe CSS para célula de duração baseada em dias. */
function durationClass(minutes: number | null): string {
  if (minutes === null) return "text-muted-foreground";
  const days = minutes / 1440;
  if (days < 1)  return "text-emerald-600 font-medium";
  if (days < 3)  return "text-yellow-600 font-medium";
  if (days < 7)  return "text-orange-600 font-medium";
  return "text-red-600 font-medium";
}

/** Formata data ISO para pt-BR legível com hora. */
function fmtDatetime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/** Formata data ISO para DD/MM/YYYY. */
function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("pt-BR");
}

/** Tempo relativo desde o log anterior na lista (para aba Registros). */
function timeSincePrev(current: AuditLog, prev: AuditLog | undefined): string {
  if (!prev) return "—";
  const diff = diffMinutes(prev.created_at, current.created_at);
  return fmtDuration(diff);
}

// ─── Badges de ação ───────────────────────────────────────────────────────────

const ACTION_GROUPS: Record<string, { label: string; variant: string; icon: React.ElementType }> = {
  // Verde — criação / aprovação / geração
  JOB_CREATED:             { label: "Job criado",           variant: "success", icon: CheckCircle2 },
  ALL_POINTS_APPROVED:     { label: "Tudo aprovado",        variant: "success", icon: CheckCircle2 },
  JOB_POINT_APPROVED:      { label: "Ponto aprovado",       variant: "success", icon: CheckCircle2 },
  RESULTADO_PPT_GENERATED: { label: "PPT gerado",           variant: "success", icon: FileDown },
  PARECER_GERADO:          { label: "Parecer gerado",       variant: "success", icon: FileDown },
  // Verde claro — importações
  ADM_PONTO_IMPORTED:      { label: "Import ADM",           variant: "secondary", icon: Upload },
  FTX_PONTO_IMPORTED:      { label: "Import FTX",           variant: "secondary", icon: Upload },
  IPI_PONTO_IMPORTED:      { label: "Import IPI",           variant: "secondary", icon: Upload },
  IR_CSLL_PONTO_IMPORTED:  { label: "Import IR/CSLL",       variant: "secondary", icon: Upload },
  INSS_PONTO_IMPORTED:     { label: "Import INSS",          variant: "secondary", icon: Upload },
  PERDCOMP_IMPORTED:       { label: "Import PER/DCOMP",     variant: "secondary", icon: Upload },
  DARF_IMPORTED:           { label: "Import DARF",          variant: "secondary", icon: Upload },
  M400_IMPORTED:           { label: "Import M400",          variant: "secondary", icon: Upload },
  M610_IMPORTED:           { label: "Import M610",          variant: "secondary", icon: Upload },
  // Laranja — devolução
  JOB_POINT_NEEDS_REVIEW:  { label: "Devolvido",            variant: "warning", icon: AlertTriangle },
  // Azul — atualizações
  JOB_POINT_NOTE_UPDATED:  { label: "Obs. salva",           variant: "outline", icon: Activity },
  JOB_STATUS_CHANGED:      { label: "Status alterado",      variant: "outline", icon: RefreshCw },
  JOB_DETAILS_UPDATED:     { label: "Job editado",          variant: "outline", icon: Activity },
  USER_CREATED:            { label: "Usuário criado",       variant: "outline", icon: Users },
  USER_UPDATED:            { label: "Usuário editado",      variant: "outline", icon: Users },
  // Vermelho — exclusões
  JOB_DELETED:             { label: "Job excluído",         variant: "destructive", icon: Trash2 },
  CLIENT_DELETED:          { label: "Cliente excluído",     variant: "destructive", icon: Trash2 },
  ADM_CLEARED:             { label: "ADM limpo",            variant: "destructive", icon: Trash2 },
  FTX_CLEARED:             { label: "FTX limpo",            variant: "destructive", icon: Trash2 },
  PERDCOMP_CLEARED:        { label: "PER/DCOMP limpo",      variant: "destructive", icon: Trash2 },
  DARF_CLEARED:            { label: "DARF limpo",           variant: "destructive", icon: Trash2 },
};

function ActionBadge({ action }: { action: string }) {
  const cfg = ACTION_GROUPS[action];
  if (!cfg) {
    return <Badge variant="outline" className="text-xs font-mono">{action}</Badge>;
  }
  const Icon = cfg.icon;
  return (
    <Badge
      variant={cfg.variant as Parameters<typeof Badge>[0]["variant"]}
      className="text-xs gap-1 whitespace-nowrap"
    >
      <Icon className="h-3 w-3" />
      {cfg.label}
    </Badge>
  );
}

// ─── Aba Registros ────────────────────────────────────────────────────────────

function RegistrosTab() {
  const [page, setPage]           = useState(1);
  const [search, setSearch]       = useState("");
  const [actionFilter, setAction] = useState<string>("_all");
  const [dateFrom, setDateFrom]   = useState("");
  const [dateTo, setDateTo]       = useState("");
  const limit = 50;

  // Filtros efetivos (sem disparar query a cada keystroke)
  const [applied, setApplied] = useState({
    search: "", action: "_all", dateFrom: "", dateTo: "",
  });

  function applyFilters() {
    setPage(1);
    setApplied({ search, action: actionFilter, dateFrom, dateTo });
  }

  function clearFilters() {
    setSearch(""); setAction("_all"); setDateFrom(""); setDateTo("");
    setPage(1);
    setApplied({ search: "", action: "_all", dateFrom: "", dateTo: "" });
  }

  const { data: actionsData } = useQuery({
    queryKey: ["log-actions"],
    queryFn: logsApi.listActions,
    staleTime: 5 * 60_000,
  });

  const { data, isFetching } = useQuery({
    queryKey: ["logs", applied, page],
    queryFn: () => logsApi.list({
      search:    applied.search   || undefined,
      action:    applied.action !== "_all" ? applied.action : undefined,
      date_from: applied.dateFrom || undefined,
      date_to:   applied.dateTo  || undefined,
      page,
      limit,
    }),
    placeholderData: (prev) => prev,
  });

  const rows   = data?.data ?? [];
  const total  = data?.total ?? 0;
  const pages  = Math.ceil(total / limit);

  return (
    <div className="space-y-4">
      {/* Filtros */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div className="flex-1 min-w-[180px]">
              <label className="text-xs text-muted-foreground mb-1 block">Busca</label>
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-8 h-9 text-sm"
                  placeholder="usuário, ação, detalhes…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && applyFilters()}
                />
              </div>
            </div>

            <div className="min-w-[180px]">
              <label className="text-xs text-muted-foreground mb-1 block">Ação</label>
              <Select value={actionFilter} onValueChange={setAction}>
                <SelectTrigger className="h-9 text-sm">
                  <SelectValue placeholder="Todas as ações" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Todas as ações</SelectItem>
                  {(actionsData ?? []).map((a) => (
                    <SelectItem key={a} value={a}>{a}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <label className="text-xs text-muted-foreground mb-1 block">De</label>
              <Input
                type="date" className="h-9 text-sm w-36"
                value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Até</label>
              <Input
                type="date" className="h-9 text-sm w-36"
                value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              />
            </div>

            <div className="flex gap-2">
              <Button size="sm" onClick={applyFilters}>
                <Search className="h-3.5 w-3.5 mr-1" /> Filtrar
              </Button>
              <Button size="sm" variant="outline" onClick={clearFilters}>
                Limpar
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Tabela */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-36">Data/Hora</TableHead>
                  <TableHead className="w-20 text-center">Δ tempo</TableHead>
                  <TableHead className="w-36">Usuário</TableHead>
                  <TableHead className="w-44">Ação</TableHead>
                  <TableHead>Job / Entidade</TableHead>
                  <TableHead>Detalhes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isFetching && rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                      Carregando…
                    </TableCell>
                  </TableRow>
                ) : rows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center py-10 text-muted-foreground text-sm">
                      Nenhum registro encontrado.
                    </TableCell>
                  </TableRow>
                ) : rows.map((log, idx) => (
                  <TableRow key={log.id} className="text-sm">
                    <TableCell className="font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {fmtDatetime(log.created_at)}
                    </TableCell>
                    <TableCell className="text-center text-xs text-muted-foreground">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span className="cursor-default">
                            {timeSincePrev(log, rows[idx + 1])}
                          </span>
                        </TooltipTrigger>
                        {rows[idx + 1] && (
                          <TooltipContent className="text-xs">
                            Desde o log anterior ({fmtDatetime(rows[idx + 1].created_at)})
                          </TooltipContent>
                        )}
                      </Tooltip>
                    </TableCell>
                    <TableCell>
                      <div className="text-xs">
                        <div className="font-medium">{log.user_name ?? "—"}</div>
                        {log.user_email && (
                          <div className="text-muted-foreground truncate max-w-[130px]">
                            {log.user_email}
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ActionBadge action={log.action} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {log.job_number ? (
                        <span className="font-medium text-foreground">#{log.job_number}</span>
                      ) : null}
                      {log.entity_type && (
                        <span className="ml-1 opacity-60">{log.entity_type}{log.entity_id ? ` #${log.entity_id}` : ""}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[240px]">
                      {log.details ? (
                        <code className="text-xs text-muted-foreground break-all">
                          {JSON.stringify(log.details)}
                        </code>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Paginação */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-muted-foreground">
          <span>{total.toLocaleString("pt-BR")} registros</span>
          <div className="flex items-center gap-2">
            <Button
              size="sm" variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span>Pág. {page} / {pages}</span>
            <Button
              size="sm" variant="outline"
              disabled={page >= pages}
              onClick={() => setPage((p) => p + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Aba Produtividade ────────────────────────────────────────────────────────

/** Calcula média em minutos de um array (ignora nulls). */
function avgMinutes(values: (number | null)[]): number | null {
  const valid = values.filter((v): v is number => v !== null);
  if (!valid.length) return null;
  return valid.reduce((a, b) => a + b, 0) / valid.length;
}

interface PhaseStats {
  label: string;
  description: string;
  values: (number | null)[];
}

function MetricCard({ label, description, minutes, icon: Icon }: {
  label: string;
  description: string;
  minutes: number | null;
  icon: React.ElementType;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
          <Icon className="h-4 w-4" />
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold tabular-nums ${durationClass(minutes)}`}>
          {fmtDuration(minutes)}
        </p>
        <p className="text-xs text-muted-foreground mt-1">{description}</p>
      </CardContent>
    </Card>
  );
}

function DurationCell({ minutes }: { minutes: number | null }) {
  return (
    <TableCell className={`text-xs tabular-nums whitespace-nowrap ${durationClass(minutes)}`}>
      {fmtDuration(minutes)}
    </TableCell>
  );
}

function ProdutividadeTab() {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo]     = useState("");
  const [applied, setApplied]   = useState({ dateFrom: "", dateTo: "" });

  function applyFilters() {
    setApplied({ dateFrom, dateTo });
  }

  const { data: jobs = [], isFetching } = useQuery({
    queryKey: ["productivity", applied],
    queryFn: () => logsApi.getProductivity({
      date_from: applied.dateFrom || undefined,
      date_to:   applied.dateTo  || undefined,
    }),
    placeholderData: (prev) => prev,
  });

  // Calcula durações por job
  const computed = useMemo(() => jobs.map((j) => ({
    ...j,
    d1: diffMinutes(j.job_created_at,          j.first_import_at),
    d2: diffMinutes(j.first_import_at,          j.last_import_at),
    d3: diffMinutes(j.last_import_at,           j.first_obs_at),
    d4: diffMinutes(j.first_obs_at,             j.last_obs_at),
    d5: diffMinutes(j.last_obs_at,              j.first_status_change_at),
    d6: diffMinutes(j.all_approved_at,          j.first_output_at),
    returnRate: j.total_review_actions > 0
      ? (j.needs_review_count / j.total_review_actions) * 100
      : null,
  })), [jobs]);

  // Médias globais
  const phases: PhaseStats[] = [
    { label: "Abertura → 1º import",       description: "Tempo até o analista iniciar a importação de dados",    values: computed.map((j) => j.d1) },
    { label: "1º import → último import",  description: "Duração da fase de importação de todos os dados",       values: computed.map((j) => j.d2) },
    { label: "Último import → 1ª obs.",    description: "Tempo até o analista começar a redigir observações",    values: computed.map((j) => j.d3) },
    { label: "1ª obs. → última obs.",      description: "Duração da fase de redação das observações",            values: computed.map((j) => j.d4) },
    { label: "Última obs. → envio revisão",description: "Tempo entre finalizar obs. e enviar ao admin",          values: computed.map((j) => j.d5) },
    { label: "Aprovação → output",         description: "Tempo da aprovação total até gerar PPT ou Parecer",     values: computed.map((j) => j.d6) },
  ];

  const phaseIcons = [Clock, Upload, ArrowRight, Activity, RefreshCw, FileDown];

  const avgReturnRate = useMemo(() => {
    const valid = computed.filter((j) => j.returnRate !== null).map((j) => j.returnRate!);
    return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null;
  }, [computed]);

  return (
    <div className="space-y-6">
      {/* Filtro de período */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex flex-wrap gap-2 items-end">
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">Jobs criados de</label>
              <Input
                type="date" className="h-9 text-sm w-36"
                value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground mb-1 block">até</label>
              <Input
                type="date" className="h-9 text-sm w-36"
                value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={applyFilters}>
              <Calendar className="h-3.5 w-3.5 mr-1" /> Aplicar
            </Button>
            {(applied.dateFrom || applied.dateTo) && (
              <Button size="sm" variant="outline" onClick={() => {
                setDateFrom(""); setDateTo("");
                setApplied({ dateFrom: "", dateTo: "" });
              }}>
                Limpar
              </Button>
            )}
            <span className="text-xs text-muted-foreground ml-auto">
              {isFetching ? "Carregando…" : `${jobs.length} jobs`}
            </span>
          </div>
        </CardContent>
      </Card>

      {/* Cards de médias por fase */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
          <BarChart3 className="h-4 w-4" /> Médias por fase do fluxo
        </h3>
        <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
          {phases.map((phase, i) => (
            <MetricCard
              key={phase.label}
              label={phase.label}
              description={phase.description}
              minutes={avgMinutes(phase.values)}
              icon={phaseIcons[i]}
            />
          ))}
        </div>
        {/* Taxa de devolução */}
        <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" /> Taxa média de devolução (admin)
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className={`text-2xl font-bold tabular-nums ${
                avgReturnRate === null ? "text-muted-foreground" :
                avgReturnRate < 15 ? "text-emerald-600" :
                avgReturnRate < 35 ? "text-yellow-600" : "text-red-600"
              }`}>
                {avgReturnRate === null ? "—" : `${avgReturnRate.toFixed(1)}%`}
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                % de ações de revisão que resultaram em devolução
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Jobs com análise concluída
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-2xl font-bold tabular-nums text-foreground">
                {computed.filter((j) => j.first_output_at).length}
                <span className="text-sm text-muted-foreground font-normal ml-1">
                  / {computed.length}
                </span>
              </p>
              <p className="text-xs text-muted-foreground mt-1">
                Jobs que geraram PPT ou Parecer
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Tabela por job */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2 text-muted-foreground">
          <Activity className="h-4 w-4" /> Detalhe por job
        </h3>
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="text-xs">
                    <TableHead className="w-24">Job</TableHead>
                    <TableHead className="max-w-[140px]">Empresa</TableHead>
                    <TableHead className="w-24">Criado em</TableHead>
                    <TableHead className="w-28">Criado por</TableHead>
                    <TableHead className="w-28 text-center" title="Abertura → 1º import">
                      Abertura<br/>→ Import
                    </TableHead>
                    <TableHead className="w-28 text-center" title="1º import → último import">
                      Fase<br/>Importação
                    </TableHead>
                    <TableHead className="w-28 text-center" title="Último import → 1ª observação">
                      Import<br/>→ 1ª obs.
                    </TableHead>
                    <TableHead className="w-28 text-center" title="1ª obs. → última obs.">
                      Fase<br/>Obs.
                    </TableHead>
                    <TableHead className="w-28 text-center" title="Última obs. → envio revisão">
                      Obs.<br/>→ Revisão
                    </TableHead>
                    <TableHead className="w-24 text-center" title="Aprovação total → output">
                      Aprov.<br/>→ Output
                    </TableHead>
                    <TableHead className="w-20 text-center" title="% de devoluções">
                      Devol.
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {computed.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={11} className="text-center py-10 text-muted-foreground text-sm">
                        {isFetching ? "Carregando…" : "Nenhum job encontrado."}
                      </TableCell>
                    </TableRow>
                  ) : computed.map((j) => (
                    <TableRow key={j.job_id} className="text-sm">
                      <TableCell className="font-medium">#{j.job_number}</TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-[140px] truncate">
                        {j.company_name ?? "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDate(j.job_created_at)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {j.created_by ?? "—"}
                      </TableCell>
                      <DurationCell minutes={j.d1} />
                      <DurationCell minutes={j.d2} />
                      <DurationCell minutes={j.d3} />
                      <DurationCell minutes={j.d4} />
                      <DurationCell minutes={j.d5} />
                      <DurationCell minutes={j.d6} />
                      <TableCell className={`text-xs text-center tabular-nums ${
                        j.returnRate === null ? "text-muted-foreground" :
                        j.returnRate < 15 ? "text-emerald-600 font-medium" :
                        j.returnRate < 35 ? "text-yellow-600 font-medium" : "text-red-600 font-medium"
                      }`}>
                        {j.returnRate === null ? "—" : `${j.returnRate.toFixed(0)}%`}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
        {/* Legenda de cores */}
        <div className="flex gap-4 mt-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-500 inline-block"/>{"< 1 dia"}</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-yellow-500 inline-block"/>1–3 dias</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-orange-500 inline-block"/>3–7 dias</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-500 inline-block"/>&gt;7 dias</span>
        </div>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

function LogsPage() {
  return (
    <div className="p-6 max-w-[1400px] mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Logs & Produtividade</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Auditoria de todas as ações do sistema e análise de eficiência por job.
        </p>
      </div>

      <Tabs defaultValue="registros">
        <TabsList>
          <TabsTrigger value="registros" className="gap-2">
            <Activity className="h-4 w-4" /> Registros
          </TabsTrigger>
          <TabsTrigger value="produtividade" className="gap-2">
            <TrendingUp className="h-4 w-4" /> Produtividade
          </TabsTrigger>
        </TabsList>

        <TabsContent value="registros" className="mt-4">
          <RegistrosTab />
        </TabsContent>

        <TabsContent value="produtividade" className="mt-4">
          <ProdutividadeTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}