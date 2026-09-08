# Studio Fiscal — Frontend

SPA em React + TypeScript (Vite, sem SSR) para a plataforma de análise de
créditos tributários do Grupo Studio. Adaptado de um projeto anterior
(mesma base de design tokens/AppShell), com a identidade visual trocada
para o amarelo do Grupo Studio, i18n removido, e páginas dedicadas ao
fluxo de Jobs/diagnóstico/pontos de crédito descrito no backend.

## Stack

Vite 7 · React 19 · TypeScript · TanStack Router (file-based) · TanStack
Query · Tailwind v4 (CSS-first, tokens em `src/styles.css`) · shadcn/ui
(Radix) · axios · react-hook-form + zod (disponível, ainda não usado em
todo formulário) · sonner (toasts).

## Rodando

```bash
npm install
cp .env.example .env          # ajuste VITE_API_BASE_URL pra porta do seu Express local
npm run dev                   # http://localhost:5173, com proxy /api -> backend
```

**Build de produção** (só isso, sem servidor Node próprio):
```bash
npm run build                 # gera dist/ — HTML/CSS/JS estáticos
```
`dist/` é pra ser servido pelo backend Express (`express.static('dist')` +
fallback de `index.html` pra rotas do client-side router). Veja o próprio
repo do backend para o `server.js` que já faz isso.

⚠️ **Ordem do script `build` importa**: é `vite build && tsc --noEmit`, não
o contrário. O plugin do TanStack Router gera `src/routeTree.gen.ts`
durante o `vite build`; rodar `tsc` antes disso falha num clone limpo
porque o arquivo ainda não existe. (Isso quebrou na primeira versão daqui
— corrigido.)

## Estrutura

```
src/
  lib/
    api.ts          cliente axios centralizado — toda chamada HTTP passa por aqui
    auth.tsx         AuthProvider + useAuth() — sessão, tokens, restore ao dar F5
    types.ts          tipos espelhando o schema/contrato do backend
    utils.ts           cn() (clsx + tailwind-merge)
  components/
    ui/               primitivas shadcn (button, input, select, dialog, progress, switch...)
    job-wizard/
      DiagnosticoForm.tsx   as 8 perguntas do diagnóstico (1:1 por job)
      TributoPanel.tsx       lista de pontos de um tributo + botão "revisar pendentes"
      RevisaoPonto.tsx        o Modo Revisão — um ponto por vez, decisão + valores mensais
    AppShell.tsx        sidebar + topbar (nav muda conforme role do usuário)
    NewJobDialog.tsx      modal de criação de Job (busca/cria cliente inline)
    ProtectedRoute.tsx     guarda de rota (autenticado / admin), usa useAuth()
  routes/               file-based routing do TanStack Router
    __root.tsx             layout raiz (AppShell + <Outlet/>)
    login.tsx
    index.tsx               redirect -> /jobs
    jobs/index.tsx           lista de jobs
    jobs/$jobId.tsx           o wizard (sidebar de seções + progresso)
    admin/usuarios.tsx
    admin/pontos-de-credito.tsx
```

`src/routeTree.gen.ts` **não está no repo** — é gerado automaticamente pelo
plugin do Vite (`@tanstack/router-plugin`) toda vez que você roda `dev` ou
`build`. Não precisa (e não deve) editar esse arquivo à mão.

## Autenticação

`lib/auth.tsx` guarda o usuário logado em contexto React. `accessToken`
fica só em memória (módulo `api.ts`); `refreshToken` vai pro
`localStorage` pra sobreviver a um F5 — ao carregar o app, `AuthProvider`
tenta restaurar a sessão chamando `GET /auth/me` (que já aciona o
interceptor de refresh automático do `api.ts` se o access token em memória
não existir ainda).

`ProtectedRoute` (componente, não `beforeLoad` do router — mais simples de
acompanhar) redireciona pra `/login` se não houver sessão, e pra `/jobs` se
uma rota `requireAdmin` for acessada por um usuário comum.

## O que é MVP de propósito (ver prompt original)

Só o fluxo guiado do Job (diagnóstico + pontos de crédito) e as duas telas
de admin. **Não** tem: telas de DARF/SPED/PER-DCOMP/observações de
INSS/pareceres, gestão de clientes dedicada (só o quick-create dentro do
modal de novo Job), nem barra de progresso na lista de jobs (evitei N+1
requests — o progresso só aparece dentro do wizard de cada job).

## Coisas que valem revisar antes de produção

- **Chunk único de ~584 kB** no build — o Vite avisa. Não é bloqueante,
  mas dá pra melhorar com `build.rollupOptions.output.manualChunks` ou
  `React.lazy()` nas rotas quando o app crescer.
- `RevisaoPonto.tsx` assume que o `period_start`/`period_end` do Job cobre
  os meses relevantes — o operador pode adicionar qualquer mês manualmente,
  mas não há validação de que o mês está dentro do período do Job.
- Sem paginação nas listas de admin (`usuarios`, `pontos-de-credito`) —
  busca até 50/100 registros de uma vez. Ok pro volume atual, revisitar se
  crescer muito.
