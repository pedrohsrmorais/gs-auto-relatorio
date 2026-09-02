process.env.JWT_ACCESS_SECRET = process.env.JWT_ACCESS_SECRET || 'test-secret';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_USER = process.env.DB_USER || 'studio_app';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'StudioFiscal_2026!';
process.env.DB_NAME = process.env.DB_NAME || 'studio_fiscal';

const assert = require('assert');
const bcrypt = require('bcryptjs');
const request = require('supertest');
const app = require('../src/server');
const { pool } = require('../src/config/database');

async function main() {
  console.log('--- seed: admin bootstrap direto no banco (chicken-and-egg de quem cria o 1º admin) ---');
  // Limpa execuções anteriores respeitando FKs: jobs do cliente de teste
  // primeiro (cascade cuida de team_members/analyses/etc.), depois o
  // cliente, só então os usuários de teste.
  const [oldClients] = await pool.query("SELECT id FROM clients WHERE cnpj = '22333444000155'");
  for (const c of oldClients) {
    await pool.query('DELETE FROM jobs WHERE client_id = ?', [c.id]);
  }
  await pool.query("DELETE FROM clients WHERE cnpj = '22333444000155'");
  await pool.query("DELETE FROM users WHERE email LIKE 'http-test%@grupostudio.com.br'");

  const adminHash = await bcrypt.hash('senhaAdmin123', 12);
  const [adminResult] = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, job_title) VALUES (?, ?, ?, 'admin', 'Gerente Tributário')`,
    ['Admin HTTP Test', 'http-test-admin@grupostudio.com.br', adminHash]
  );
  const adminId = adminResult.insertId;

  console.log('--- POST /api/auth/login (admin) ---');
  let res = await request(app).post('/api/auth/login').send({ email: 'http-test-admin@grupostudio.com.br', password: 'senhaAdmin123' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const adminToken = res.body.data.accessToken;
  assert.ok(adminToken);
  console.log('  login OK');

  console.log('--- GET /api/auth/me sem token -> 401 ---');
  res = await request(app).get('/api/auth/me');
  assert.strictEqual(res.status, 401, JSON.stringify(res.body));
  assert.strictEqual(res.body.success, false);
  console.log('  401 OK');

  console.log('--- GET /api/auth/me com token -> 200 ---');
  res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${adminToken}`);
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.email, 'http-test-admin@grupostudio.com.br');
  console.log('  200 OK');

  console.log('--- POST /api/users (admin cria operador "user") ---');
  res = await request(app).post('/api/users').set('Authorization', `Bearer ${adminToken}`).send({
    name: 'Operador HTTP Test', email: 'http-test-user@grupostudio.com.br', password: 'senhaUser123', role: 'user', job_title: 'Analista Fiscal',
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  console.log('  201 OK, id=', res.body.data.id);

  console.log('--- login como "user" e testar bloqueio de rota admin-only ---');
  res = await request(app).post('/api/auth/login').send({ email: 'http-test-user@grupostudio.com.br', password: 'senhaUser123' });
  const userToken = res.body.data.accessToken;

  res = await request(app).post('/api/credit-points').set('Authorization', `Bearer ${userToken}`).send({ tax_id: 1, name: 'Ponto Bloqueado' });
  assert.strictEqual(res.status, 403, JSON.stringify(res.body));
  console.log('  403 OK (user comum não cria ponto de crédito)');

  console.log('--- POST /api/credit-points como admin -> 201 ---');
  res = await request(app).post('/api/credit-points').set('Authorization', `Bearer ${adminToken}`).send({
    tax_id: 1, name: `Ponto HTTP Test ${Date.now()}`, category: 'ADM', legal_criteria: 'Teste HTTP',
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const creditPoint = res.body.data;
  console.log('  201 OK, id=', creditPoint.id);

  console.log('--- fluxo completo de Job via HTTP (como "user" comum) ---');
  const h = { Authorization: `Bearer ${userToken}` };

  res = await request(app).post('/api/clients').set(h).send({
    cnpj: '22.333.444/0001-55', company_name: 'Empresa HTTP Test LTDA', tax_regime: 'Lucro Real',
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const client = res.body.data;

  res = await request(app).post('/api/jobs').set(h).send({
    job_number: `JOB-HTTP-${Date.now()}`, client_id: client.id, period_start: '2021-01-01', period_end: '2026-06-30',
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const job = res.body.data;
  console.log('  job criado id=', job.id);

  res = await request(app).post(`/api/jobs/${job.id}/team`).set(h).send({ user_id: adminId, role_in_job: 'gerente_tributario' });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));

  res = await request(app).get(`/api/jobs/${job.id}`).set(h);
  assert.strictEqual(res.status, 200);
  assert.strictEqual(res.body.data.team.length, 1);
  console.log('  team via GET /jobs/:id OK');

  res = await request(app).put(`/api/jobs/${job.id}/diagnostic`).set(h).send({ pays_darf: true, avg_monthly_pis_cofins: 30000 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  console.log('  diagnostic (rota aninhada com mergeParams) OK');

  res = await request(app).put(`/api/jobs/${job.id}/credit-analyses/by-credit-point/${creditPoint.id}`).set(h).send({
    has_credit: true, observations: 'Teste via HTTP',
  });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  const analysis = res.body.data;

  res = await request(app).put(`/api/jobs/${job.id}/credit-analyses/${analysis.id}/months/2024-03`).set(h).send({ contribution: 'PIS', value: 777.77 });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(Number(res.body.data.total_credit_value), 777.77);
  console.log('  monthly value (2 níveis de rota aninhada) OK, total=', res.body.data.total_credit_value);

  res = await request(app).post(`/api/jobs/${job.id}/darf-entries/bulk`).set(h).send({
    entries: [{ data_base: '2024-03-01', total_value: 900, assessment_period: '03/2024' }],
  });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  console.log('  darf bulk import via HTTP OK');

  res = await request(app).post(`/api/jobs/${job.id}/reports`).set(h).send({ tax_id: 1, report_type: 'PARECER_CREDITO' });
  assert.strictEqual(res.status, 201, JSON.stringify(res.body));
  const report = res.body.data;
  res = await request(app).patch(`/api/jobs/${job.id}/reports/${report.id}/status`).set(h).send({ status: 'finalizado' });
  assert.strictEqual(res.status, 200, JSON.stringify(res.body));
  assert.strictEqual(res.body.data.status, 'finalizado');
  console.log('  report + status transition OK');

  console.log('--- validação de erro: campo obrigatório faltando -> 400 ---');
  res = await request(app).post('/api/clients').set(h).send({ company_name: 'Sem CNPJ' });
  assert.strictEqual(res.status, 400, JSON.stringify(res.body));
  assert.strictEqual(res.body.success, false);
  console.log('  400 OK');

  console.log('--- rota inexistente -> 404 via notFound ---');
  res = await request(app).get('/api/rota-que-nao-existe');
  assert.strictEqual(res.status, 404, JSON.stringify(res.body));
  console.log('  404 OK');

  console.log('--- GET /health (sem auth) ---');
  res = await request(app).get('/health');
  assert.strictEqual(res.status, 200);
  console.log('  200 OK');

  console.log('\n=== TODOS OS FLUXOS HTTP PASSARAM SEM ERROS ===');
}

main()
  .catch((err) => {
    console.error('\n!!! FALHA:', err.message);
    console.error(err.stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
