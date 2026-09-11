//routes/admin/usuarios.tsx

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Search, ShieldCheck, ShieldOff, Trash2 } from "lucide-react";
import { usersApi } from "@/lib/api";
import type { JobTitle, Role, User } from "@/lib/types";
import { ProtectedRoute } from "@/components/ProtectedRoute";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";

export const Route = createFileRoute("/admin/usuarios")({
  component: () => (
    <ProtectedRoute requireAdmin>
      <UsersAdminPage />
    </ProtectedRoute>
  ),
});

const JOB_TITLES: JobTitle[] = [
  "Analista Fiscal", "Analista Tributário", "Coordenador Tributário",
  "Coordenadora Tributária", "Gerente Tributário", "Head Tributário",
];

function NewUserDialog() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<Role>("user");
  const [jobTitle, setJobTitle] = useState<JobTitle | "">("");
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: () => usersApi.create({ name, email, password, role, job_title: jobTitle || undefined }),
    onSuccess: () => {
      toast.success("Usuário criado.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setOpen(false);
      setName(""); setEmail(""); setPassword(""); setRole("user"); setJobTitle("");
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao criar usuário."),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button><Plus className="h-4 w-4" /> Novo usuário</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Novo usuário</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-xs">Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">E-mail</Label>
            <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs">Senha provisória (mín. 8 caracteres)</Label>
            <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label className="text-xs">Cargo</Label>
              <Select value={jobTitle} onValueChange={(v) => setJobTitle(v as JobTitle)}>
                <SelectTrigger><SelectValue placeholder="Selecione" /></SelectTrigger>
                <SelectContent>
                  {JOB_TITLES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Papel de acesso</Label>
              <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="user">Usuário</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
            {mutation.isPending ? "Criando…" : "Criar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function UsersAdminPage() {
  const { user: me } = useAuth();
  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ["users", search],
    queryFn: () => usersApi.list({ search: search || undefined, limit: 50 }),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, role }: { id: number; role: Role }) => usersApi.updateRole(id, role),
    onSuccess: () => { toast.success("Papel atualizado."); queryClient.invalidateQueries({ queryKey: ["users"] }); },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao atualizar papel."),
  });

  // "Excluir" usuário = soft-delete (is_active=0 + revoga sessões). Hard
  // delete quebraria com erro de FK para qualquer usuário que já criou job
  // ou está em alguma equipe (jobs.created_by, job_team_members.user_id,
  // job_reports.responsible_user_id não têm ON DELETE CASCADE).
  const deleteMutation = useMutation({
    mutationFn: (id: number) => usersApi.deactivate(id),
    onSuccess: () => {
      toast.success("Usuário excluído.");
      queryClient.invalidateQueries({ queryKey: ["users"] });
      setDeleteTarget(null);
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "Erro ao excluir usuário."),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-display font-semibold">Usuários</h1>
          <p className="text-sm text-muted-foreground">Contas da equipe do Grupo Studio.</p>
        </div>
        <NewUserDialog />
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="Buscar por nome ou e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Carregando…</p>}

      <div className="grid gap-2">
        {data?.data.map((u) => (
          <Card key={u.id} className="p-4 flex items-center justify-between">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="font-medium truncate">{u.name}</p>
                {!u.is_active && <Badge variant="destructive">Inativo</Badge>}
                <Badge variant={u.role === "admin" ? "default" : "secondary"}>{u.role}</Badge>
              </div>
              <p className="text-sm text-muted-foreground truncate">{u.email} · {u.job_title ?? "—"}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                variant="outline" size="sm"
                onClick={() => roleMutation.mutate({ id: u.id, role: u.role === "admin" ? "user" : "admin" })}
                disabled={roleMutation.isPending}
              >
                {u.role === "admin" ? <ShieldOff className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}
                {u.role === "admin" ? "Tornar usuário" : "Tornar admin"}
              </Button>
              {u.is_active && u.id !== me?.id && (
                <Button
                  variant="ghost" size="sm"
                  className="text-destructive hover:text-destructive hover:bg-destructive/10"
                  onClick={() => setDeleteTarget(u)}
                >
                  <Trash2 className="h-4 w-4" /> Excluir
                </Button>
              )}
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Excluir "{deleteTarget?.name}"?</DialogTitle></DialogHeader>
          <p className="text-sm text-muted-foreground">
            O usuário perde acesso à plataforma imediatamente (sessões ativas são revogadas).
            Jobs e pareceres em que ele já apareceu continuam intactos.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? "Excluindo…" : "Sim, excluir"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}