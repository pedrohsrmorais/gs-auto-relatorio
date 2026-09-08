import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { Landmark, Lock, Mail, TrendingUp } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/login")({
  component: LoginPage,
});

// ─── Divisor em "meia lua" entre o painel de marca e o painel de login ─────
function CurveDivider() {
  return (
    <div
      className="hidden lg:block absolute inset-y-0 right-full w-36 xl:w-44 z-10 pointer-events-none"
      style={{ filter: "drop-shadow(-14px 0 28px rgba(0,0,0,0.18))" }}
      aria-hidden="true"
    >
      <svg width="100%" height="100%" viewBox="0 0 160 1000" preserveAspectRatio="none" className="text-background">
        <path d="M160,0 C64,0 0,220 0,500 C0,780 64,1000 160,1000 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

// ─── Painel de marca (sem fotos — gradiente + grid + linha de tendência) ───
function BrandPanel() {
  return (
    <div className="hidden lg:flex lg:flex-1 text-white flex-col justify-between relative overflow-hidden bg-gradient-to-br from-slate-900 via-slate-950 to-neutral-900">
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage:
            "linear-gradient(#ffffff 1px, transparent 1px), linear-gradient(90deg, #ffffff 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />
      <div
        className="absolute top-1/3 -right-24 w-72 h-72 rounded-full pointer-events-none"
        style={{ background: "radial-gradient(circle, var(--color-primary) 0%, transparent 70%)", opacity: 0.25 }}
      />

      <svg
        viewBox="0 0 800 100"
        className="absolute bottom-0 left-0 right-0 w-full text-primary opacity-30"
        preserveAspectRatio="none"
        aria-hidden="true"
      >
        <polyline
          points="0,85 80,80 160,60 240,65 320,35 400,45 480,20 560,32 640,15 720,25 800,10"
          fill="none" stroke="currentColor" strokeWidth={1.5}
        />
      </svg>

      <div className="relative p-14 xl:p-20 flex flex-col justify-between h-full">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-primary flex items-center justify-center shrink-0">
            <Landmark className="h-5 w-5 text-primary-foreground" />
          </div>
          <span className="font-display font-bold text-2xl xl:text-3xl tracking-tight">Studio Fiscal</span>
        </div>

        <div className="space-y-6 max-w-lg xl:max-w-xl">
          <p className="text-xs xl:text-sm font-mono uppercase tracking-widest text-white/60">
            Grupo Studio — Recuperação de Créditos Tributários
          </p>
          <h2 className="text-4xl xl:text-5xl font-display font-semibold leading-tight tracking-tight">
            Cada ponto de crédito, revisado com clareza.
          </h2>
          <p className="text-base xl:text-lg text-white/75 leading-relaxed">
            Diagnóstico, análise e acompanhamento de PIS/COFINS, IRPJ/CSLL, INSS e IPI —
            tudo em um único fluxo guiado, do primeiro ao último ponto.
          </p>
          <div className="flex flex-wrap gap-2.5 pt-2">
            {["PIS/COFINS", "IRPJ/CSLL", "INSS", "IPI"].map((m) => (
              <span
                key={m}
                className="text-xs font-mono px-3 py-1.5 rounded-full border border-white/25 bg-white/10 backdrop-blur-sm text-white/80"
              >
                {m}
              </span>
            ))}
          </div>
        </div>

        <p className="text-xs text-white/40 flex items-center gap-1.5">
          <TrendingUp className="h-3.5 w-3.5" /> Plataforma interna Grupo Studio · {new Date().getFullYear()}
        </p>
      </div>
    </div>
  );
}

function LoginPage() {
  const { user, loading, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!loading && user) navigate({ to: "/jobs" });
  }, [user, loading, navigate]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const profile = await login(email, senha);
      toast.success(`Bem-vindo(a), ${profile.name.split(" ")[0]}!`);
      navigate({ to: "/jobs" });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Não foi possível entrar.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex bg-background">
      <BrandPanel />

      <div className="flex-1 lg:flex-none lg:w-[420px] xl:w-[460px] flex items-center justify-center p-6 relative bg-background">
        <CurveDivider />

        <div className="w-full max-w-xs">
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center">
              <Landmark className="h-4.5 w-4.5 text-primary-foreground" />
            </div>
            <span className="font-display font-bold text-xl">Studio Fiscal</span>
          </div>

          <div className="mb-6">
            <h1 className="text-2xl font-display font-semibold tracking-tight text-foreground">Entrar</h1>
            <p className="text-sm text-muted-foreground mt-1">Acesse com sua conta do Grupo Studio.</p>
          </div>

          <div className="rounded-2xl border border-border bg-card/70 backdrop-blur-sm p-6 shadow-sm">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="email">E-mail</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="email" type="email" required value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-9" autoComplete="email" placeholder="voce@grupostudio.com.br"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="senha">Senha</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="senha" type="password" required value={senha}
                    onChange={(e) => setSenha(e.target.value)}
                    className="pl-9" autoComplete="current-password"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={submitting}>
                {submitting ? "Entrando…" : "Entrar"}
              </Button>
            </form>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Sem cadastro público — sua conta é criada por um administrador do escritório.
          </p>
        </div>
      </div>
    </div>
  );
}
