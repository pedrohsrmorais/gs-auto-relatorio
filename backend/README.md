# Studio Fiscal API

API REST (Express 5 + MySQL) para a plataforma de análise de créditos
tributários do Grupo Studio, sobre o schema em `schema.sql`. Autenticação
JWT com roles `admin`/`user`, 16 controllers cobrindo as 18 tabelas, rotas
protegidas por middleware, e **testada de ponta a ponta em dois níveis**
contra um MySQL/MariaDB real — não só sintaxe, execução de verdade.

## Estrutura

```
src/
  config/database.js        pool de conexão mysql2 (promise)
  utils/                     ApiError, ApiResponse, asyncHandler, paginate, mergeUpdate
  controllers/               16 arquivos — regras de negócio, sem acessar req.headers/JWT
  middlewares/
    authenticate.js           valida "Authorization: Bearer <token>" -> req.user = {id, role, name}
    authorize.js               authorize('admin') para rotas restritas
    errorHandler.js             ApiError -> JSON; também trata ER_DUP_ENTRY / FK do mysql2
    notFound.js                  404 padronizado para rota inexistente
  routes/                    1 arquivo por recurso + index.js agregando tudo em /api
  server.js                  monta Express, helmet/cors/morgan, /health, /api, error handling
tests/
  controllers.smoke-test.js  chama os controllers direto (sem HTTP), contra o banco real
  http.smoke-test.js          supertest contra o app Express real: auth, roles, rotas aninhadas, erros
```

## Rodando

```bash
npm install
cp .env.example .env                # ajuste DB_* e JWT_ACCESS_SECRET
mysql -u root < ../schema.sql       # se ainda não aplicou o schema

npm start                           # sobe em http://localhost:3000 (GET /health para checar)
npm test                            # roda os dois smoke tests em sequência
```

### Bootstrap do primeiro admin

Não existe endpoint público de registro — contas são criadas por um admin via
`POST /api/users`. Para o **primeiro** admin (problema do ovo e da galinha),
insira direto no banco com senha já em bcrypt:

```bash
node -e "console.log(require('bcryptjs').hashSync('sua-senha-aqui', 12))"
```

```sql
INSERT INTO users (name, email, password_hash, role, job_title)
VALUES ('Seu Nome', 'voce@grupostudio.com.br', '<hash gerado acima>', 'admin', 'Gerente Tributário');
```

## Convenções

- **Resposta padronizada**: sucesso `{ success: true, data, meta?, message? }`;
  erro `{ success: false, message, details? }` (montado pelo `errorHandler`, nunca pelo controller diretamente).
- **`asyncHandler`** em todo handler — zero try/catch manual nos controllers.
- **`authenticate` + `authorize('admin')`** como middlewares de rota, nunca checados dentro do controller — controller só lê `req.user.id`/`req.user.role` quando precisa (ex: `analyzed_by`, `created_by`).
- **Rotas aninhadas via `Router({ mergeParams: true })`**: `/api/jobs/:jobId/credit-analyses/:analysisId/months/:month` funciona porque cada nível declara `mergeParams: true` — sem isso `req.params.jobId` não chega no router filho.
- **Updates parciais seguros**: `mergeUpdate(current, req.body, campos)` — busca o registro, mescla só os campos enviados, evita o problema do `COALESCE` não conseguir limpar um campo para `null`.
- **Upsert com `ON DUPLICATE KEY UPDATE`**: tabelas 1:1 por Job (`job_diagnostics`, `job_inss_technical_notes`) e séries mensais (`job_credit_monthly_values`, `job_credit_usages`, `job_monthly_revenues`).
- **Bulk insert com `VALUES ?`**: DARF/SPED M400/M610 — a aba DARF do Excel original tinha 1286 linhas, importação linha a linha não é opção.
- **Soft delete** em `users` e `credit_points` (`is_active = FALSE`) — Jobs e análises antigas continuam referenciando esses registros.
- **CNPJ sempre normalizado** para 14 dígitos sem máscara antes de tocar o banco.

## Autorização por rota (o que é admin-only)

| Ação | Quem pode |
|---|---|
| Login, ver/editar o próprio perfil e senha | Qualquer usuário autenticado |
| CRUD de `clients` e todo o módulo `jobs/*` (diagnóstico, análises, DARF, SPED, PER/DCOMP, INSS, pareceres) | Qualquer usuário autenticado (`admin` ou `user`) — é o trabalho operacional do dia a dia |
| Criar/editar/desativar usuários, trocar `role` | Só `admin` |
| Criar/editar/desativar `credit_points` (catálogo mestre) | Só `admin` |
| Editar `taxes` | Só `admin` |
| Listar `users`/`credit_points`/`taxes` | Qualquer usuário autenticado (precisa pra popular seletores) |

## Mapa completo: controller → tabela → endpoints

| Controller | Tabela(s) | Endpoints |
|---|---|---|
| `auth.controller.js` | `users`, `refresh_tokens` | `POST /auth/login` · `POST /auth/refresh` · `POST /auth/logout` · `GET /auth/me` · `PATCH /auth/me/password` |
| `user.controller.js` | `users` | `GET/POST /users` · `GET/PUT/DELETE /users/:id` · `PATCH /users/:id/role` |
| `client.controller.js` | `clients` | `GET/POST /clients` · `GET/PUT/DELETE /clients/:id` · `GET /clients/:id/jobs` |
| `job.controller.js` | `jobs`, `job_team_members` | `GET/POST /jobs` · `GET/PUT/DELETE /jobs/:id` · `PATCH /jobs/:id/status` · `GET/POST /jobs/:id/team` · `DELETE /jobs/:id/team/:memberId` |
| `tax.controller.js` | `taxes` | `GET /taxes` · `GET/PUT /taxes/:id` |
| `creditPoint.controller.js` | `credit_points` | `GET/POST /credit-points` · `GET/PUT/DELETE /credit-points/:id` |
| `jobDiagnostic.controller.js` | `job_diagnostics` | `GET/PUT /jobs/:jobId/diagnostic` |
| `jobCreditAnalysis.controller.js` | `job_credit_point_analyses`, `job_credit_monthly_values` | `GET /jobs/:jobId/credit-analyses` · `GET .../:analysisId` · `PUT .../by-credit-point/:creditPointId` · `DELETE .../:analysisId` · `PUT .../:analysisId/months/:month` · `POST .../:analysisId/months/bulk` · `DELETE .../:analysisId/months/:valueId` |
| `jobCreditUsage.controller.js` | `job_credit_usages` | `GET /jobs/:jobId/credit-usages` · `PUT/DELETE .../:month` · `POST .../bulk` |
| `jobMonthlyRevenue.controller.js` | `job_monthly_revenues` | `GET /jobs/:jobId/monthly-revenues` · `PUT/DELETE .../:month` · `POST .../bulk` |
| `jobDarf.controller.js` | `job_darf_entries` | `GET/POST /jobs/:jobId/darf-entries` · `GET/PUT/DELETE .../:id` · `POST .../bulk` · `DELETE /jobs/:jobId/darf-entries` |
| `jobSpedM400.controller.js` | `job_sped_m400_entries` | `GET /jobs/:jobId/sped-m400` · `POST .../bulk` · `DELETE .../:id` · `DELETE /jobs/:jobId/sped-m400` |
| `jobSpedM610.controller.js` | `job_sped_m610_entries` | (mesmo padrão do M400) |
| `jobPerdcomp.controller.js` | `job_perdcomps` | `GET/POST /jobs/:jobId/perdcomps` · `GET/PUT/DELETE .../:id` |
| `jobInssNotes.controller.js` | `job_inss_technical_notes` | `GET/PUT /jobs/:jobId/inss-notes` |
| `jobReport.controller.js` | `job_reports` | `GET/POST /jobs/:jobId/reports` · `GET/PUT/DELETE .../:id` · `PATCH .../:id/status` |

## O que os testes realmente cobrem

`npm run test:controllers` chama cada controller diretamente (mock de
`req`/`res`) contra o MySQL real — cobre lógica de negócio e SQL.

`npm run test:http` sobe o app Express de verdade e usa `supertest` — cobre
o que os controllers sozinhos não testam: login end-to-end, header
`Authorization`, `authenticate` rejeitando token ausente (401), `authorize`
bloqueando `user` comum numa rota admin-only (403), roteamento aninhado de
2 níveis (`/jobs/:jobId/credit-analyses/:analysisId/months/:month`),
`notFound` (404) e `errorHandler` (400 em validação).

Ambos limpam seus próprios dados de teste no início da execução (por
e-mail/CNPJ de teste) e podem ser rodados repetidamente.

## Próximos passos sugeridos

1. **Seed do catálogo `credit_points`** — os ~150 pontos já existem na
   planilha original (abas Resumo IR / Resumo PIS e COFINS / Resumo de
   Créditos INSS / Tabelas FINTAX); posso gerar o `INSERT` completo a partir
   do Excel.
2. **Validação de entrada mais robusta** — hoje os controllers fazem
   checagens manuais; para produção, considerar `express-validator` ou `zod`
   nas rotas antes do controller.
3. **Rate limiting** no `/auth/login` (ex: `express-rate-limit`) — hoje não
   há proteção contra força bruta de senha.
4. **Geração dos documentos de parecer** (PDF/DOCX) a partir de
   `job_reports` — o banco só guarda o ciclo de vida (`rascunho` →
   `finalizado` → `assinado`) e o `file_path`; a geração do arquivo em si é
   um passo separado.
