process.env.JWT_ACCESS_SECRET = 'test-secret';
process.env.DB_HOST = process.env.DB_HOST || '127.0.0.1';
process.env.DB_USER = process.env.DB_USER || 'studio_app';
process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'StudioFiscal_2026!';
process.env.DB_NAME = process.env.DB_NAME || 'studio_fiscal';

const assert = require('assert');
const { pool } = require('../src/config/database');

const userCtrl = require('../src/controllers/user.controller');
const authCtrl = require('../src/controllers/auth.controller');
const clientCtrl = require('../src/controllers/client.controller');
const jobCtrl = require('../src/controllers/job.controller');
const taxCtrl = require('../src/controllers/tax.controller');
const creditPointCtrl = require('../src/controllers/creditPoint.controller');
const jobDiagnosticCtrl = require('../src/controllers/jobDiagnostic.controller');
const jobCreditAnalysisCtrl = require('../src/controllers/jobCreditAnalysis.controller');
const jobCreditUsageCtrl = require('../src/controllers/jobCreditUsage.controller');
const jobMonthlyRevenueCtrl = require('../src/controllers/jobMonthlyRevenue.controller');
const jobDarfCtrl = require('../src/controllers/jobDarf.controller');
const jobSpedM400Ctrl = require('../src/controllers/jobSpedM400.controller');
const jobSpedM610Ctrl = require('../src/controllers/jobSpedM610.controller');
const jobPerdcompCtrl = require('../src/controllers/jobPerdcomp.controller');
const jobInssNotesCtrl = require('../src/controllers/jobInssNotes.controller');
const jobReportCtrl = require('../src/controllers/jobReport.controller');

// --- mock req/res que captura o que o controller responderia -----------
function call(fn, { params = {}, query = {}, body = {}, user = null } = {}) {
  return new Promise((resolve, reject) => {
    const req = { params, query, body, user };
    let statusCode = 200;
    const res = {
      status(code) { statusCode = code; return this; },
      json(payload) { resolve({ statusCode, payload }); },
      send() { resolve({ statusCode, payload: null }); },
    };
    const next = (err) => { if (err) reject(err); };
    // fn já é o resultado de asyncHandler(): internamente ele faz
    // Promise.resolve(...).catch(next), então basta invocar e deixar
    // res.json()/next() resolverem/rejeitarem esta Promise.
    fn(req, res, next);
  });
}

function expectOk(result, label) {
  if (!result.payload || result.payload.success !== true) {
    throw new Error(`[${label}] esperava success=true, recebeu: ${JSON.stringify(result.payload)}`);
  }
  return result.payload.data;
}

async function main() {
  console.log('--- limpando dados de teste anteriores ---');
  // Apaga primeiro os jobs do cliente de teste (cascade cuida do resto),
  // só depois o cliente e o usuário — respeitando as FKs.
  const [oldClients] = await pool.query("SELECT id FROM clients WHERE cnpj = '11222333000181'");
  for (const c of oldClients) {
    await pool.query('DELETE FROM jobs WHERE client_id = ?', [c.id]);
  }
  await pool.query("DELETE FROM clients WHERE cnpj = '11222333000181'");
  await pool.query("DELETE FROM users WHERE email = 'teste.controller@grupostudio.com.br'");

  console.log('--- users.create ---');
  let r = await call(userCtrl.create, {
    body: { name: 'Usuário Teste', email: 'teste.controller@grupostudio.com.br', password: 'senha12345', role: 'admin', job_title: 'Analista Fiscal' },
  });
  const user = expectOk(r, 'users.create');
  assert.strictEqual(r.statusCode, 201);
  console.log('  user criado id=', user.id);

  console.log('--- auth.login ---');
  r = await call(authCtrl.login, { body: { email: user.email, password: 'senha12345' } });
  const loginData = expectOk(r, 'auth.login');
  assert.ok(loginData.accessToken && loginData.refreshToken);
  console.log('  login OK, tokens emitidos');

  console.log('--- auth.refresh ---');
  r = await call(authCtrl.refresh, { body: { refreshToken: loginData.refreshToken } });
  const refreshed = expectOk(r, 'auth.refresh');
  assert.ok(refreshed.accessToken);
  console.log('  refresh OK (rotacionado)');

  console.log('--- auth.me ---');
  r = await call(authCtrl.me, { user: { id: user.id } });
  expectOk(r, 'auth.me');
  console.log('  me OK');

  console.log('--- clients.create ---');
  r = await call(clientCtrl.create, {
    body: { cnpj: '11.222.333/0001-81', company_name: 'Empresa Teste Controllers LTDA', segment: 'Indústria', tax_regime: 'Lucro Real' },
  });
  const client = expectOk(r, 'clients.create');
  assert.strictEqual(r.statusCode, 201);
  console.log('  client criado id=', client.id, 'cnpj=', client.cnpj);

  console.log('--- jobs.create ---');
  r = await call(jobCtrl.create, {
    body: { job_number: `JOB-TEST-${Date.now()}`, client_id: client.id, period_start: '2021-01-01', period_end: '2026-06-30', tax_regime: 'Lucro Real' },
    user: { id: user.id },
  });
  const job = expectOk(r, 'jobs.create');
  console.log('  job criado id=', job.id);

  console.log('--- jobs.addTeamMember ---');
  r = await call(jobCtrl.addTeamMember, { params: { id: job.id }, body: { user_id: user.id, role_in_job: 'gerente_tributario' } });
  expectOk(r, 'jobs.addTeamMember');
  console.log('  membro adicionado');

  console.log('--- jobs.getById (com team) ---');
  r = await call(jobCtrl.getById, { params: { id: job.id } });
  const jobDetail = expectOk(r, 'jobs.getById');
  assert.strictEqual(jobDetail.team.length, 1);
  console.log('  team.length =', jobDetail.team.length);

  console.log('--- taxes.list ---');
  r = await call(taxCtrl.list, {});
  const taxes = expectOk(r, 'taxes.list');
  assert.strictEqual(taxes.length, 4);
  const pisCofins = taxes.find((t) => t.code === 'PIS_COFINS');
  console.log('  taxes OK, PIS_COFINS id=', pisCofins.id);

  console.log('--- creditPoints.create ---');
  r = await call(creditPointCtrl.create, {
    body: { tax_id: pisCofins.id, name: `Ponto Teste ${Date.now()}`, category: 'ADM', legal_criteria: 'Teste automatizado' },
  });
  const creditPoint = expectOk(r, 'creditPoints.create');
  console.log('  credit point criado id=', creditPoint.id);

  console.log('--- jobDiagnostic.upsert ---');
  r = await call(jobDiagnosticCtrl.upsert, {
    params: { jobId: job.id },
    body: { pays_darf: true, avg_monthly_pis_cofins: 50000, opportunities_above_500k: true, estimated_usage_months: 12 },
  });
  const diag = expectOk(r, 'jobDiagnostic.upsert');
  assert.strictEqual(Number(diag.avg_monthly_pis_cofins), 50000);
  console.log('  diagnostic OK');

  console.log('--- jobCreditAnalysis.upsertByCreditPoint ---');
  r = await call(jobCreditAnalysisCtrl.upsertByCreditPoint, {
    params: { jobId: job.id, creditPointId: creditPoint.id },
    body: { has_credit: true, observations: 'Cliente possui documentação compatível' },
    user: { id: user.id },
  });
  const analysis = expectOk(r, 'jobCreditAnalysis.upsertByCreditPoint');
  console.log('  analysis id=', analysis.id);

  console.log('--- jobCreditAnalysis.setMonthlyValue ---');
  r = await call(jobCreditAnalysisCtrl.setMonthlyValue, {
    params: { jobId: job.id, analysisId: analysis.id, month: '2024-03' },
    body: { contribution: 'PIS', value: 1500.5 },
  });
  let mv = expectOk(r, 'jobCreditAnalysis.setMonthlyValue (PIS)');
  assert.strictEqual(Number(mv.total_credit_value), 1500.5);

  r = await call(jobCreditAnalysisCtrl.setMonthlyValue, {
    params: { jobId: job.id, analysisId: analysis.id, month: '2024-03' },
    body: { contribution: 'COFINS', value: 6900.75 },
  });
  mv = expectOk(r, 'jobCreditAnalysis.setMonthlyValue (COFINS)');
  assert.strictEqual(Number(mv.total_credit_value), 1500.5 + 6900.75);
  console.log('  total_credit_value recalculado =', mv.total_credit_value);

  console.log('--- jobCreditAnalysis.bulkSetMonthlyValues ---');
  r = await call(jobCreditAnalysisCtrl.bulkSetMonthlyValues, {
    params: { jobId: job.id, analysisId: analysis.id },
    body: {
      entries: [
        { contribution: 'PIS', reference_month: '2024-04', value: 100 },
        { contribution: 'COFINS', reference_month: '2024-04', value: 460 },
      ],
    },
  });
  const bulkResult = expectOk(r, 'jobCreditAnalysis.bulkSetMonthlyValues');
  assert.strictEqual(bulkResult.monthlyValues.length, 4);
  console.log('  bulk OK, total_credit_value =', bulkResult.total_credit_value);

  console.log('--- jobCreditAnalysis.getById (com monthlyValues) ---');
  r = await call(jobCreditAnalysisCtrl.getById, { params: { jobId: job.id, analysisId: analysis.id } });
  const analysisDetail = expectOk(r, 'jobCreditAnalysis.getById');
  assert.strictEqual(analysisDetail.monthlyValues.length, 4);
  console.log('  monthlyValues.length =', analysisDetail.monthlyValues.length);

  console.log('--- jobCreditUsage.upsert + bulkUpsert ---');
  r = await call(jobCreditUsageCtrl.upsert, { params: { jobId: job.id, month: '2024-03' }, body: { pis_credit: 1500.5, darf_collected: 900 } });
  expectOk(r, 'jobCreditUsage.upsert');
  r = await call(jobCreditUsageCtrl.bulkUpsert, {
    params: { jobId: job.id },
    body: { entries: [{ reference_month: '2024-04', pis_credit: 100, darf_collected: 50 }] },
  });
  expectOk(r, 'jobCreditUsage.bulkUpsert');
  console.log('  usage OK');

  console.log('--- jobMonthlyRevenue.upsert ---');
  r = await call(jobMonthlyRevenueCtrl.upsert, {
    params: { jobId: job.id, month: '2024-03' },
    body: { taxed_revenue: 100000, untaxed_revenue: 5000, pct_untaxed_outputs: 0.05 },
  });
  const revenue = expectOk(r, 'jobMonthlyRevenue.upsert');
  assert.strictEqual(Number(revenue.total_revenue), 105000);
  console.log('  total_revenue (coluna gerada) =', revenue.total_revenue);

  console.log('--- jobDarf.bulkImport + list ---');
  r = await call(jobDarfCtrl.bulkImport, {
    params: { jobId: job.id },
    body: { entries: [
      { data_base: '2024-03-01', darf_code: '2172', total_value: 900, assessment_period: '03/2024', cnpj: client.cnpj },
      { data_base: '2024-04-01', darf_code: '2172', total_value: 950, assessment_period: '04/2024', cnpj: client.cnpj },
    ] },
  });
  expectOk(r, 'jobDarf.bulkImport');
  r = await call(jobDarfCtrl.list, { params: { jobId: job.id } });
  const darfList = expectOk(r, 'jobDarf.list');
  assert.strictEqual(darfList.length, 2);
  console.log('  DARF importado, total registros =', darfList.length);

  console.log('--- jobSpedM400.bulkImport + jobSpedM610.bulkImport ---');
  r = await call(jobSpedM400Ctrl.bulkImport, {
    params: { jobId: job.id },
    body: { entries: [{ reference_month: '2024-03', cst: '04', gross_revenue_value: 10000 }] },
  });
  expectOk(r, 'jobSpedM400.bulkImport');
  r = await call(jobSpedM610Ctrl.bulkImport, {
    params: { jobId: job.id },
    body: { entries: [{ reference_month: '2024-03', contribution_code: '01', gross_revenue_value: 10000, calculation_base_value: 9000 }] },
  });
  expectOk(r, 'jobSpedM610.bulkImport');
  console.log('  SPED M400/M610 OK');

  console.log('--- jobPerdcomp.create ---');
  r = await call(jobPerdcompCtrl.create, {
    params: { jobId: job.id },
    body: { perdcomp_number: `PERDCOMP-${Date.now()}`, transmission_date: '2024-05-01', credit_type: 'PIS/COFINS' },
  });
  expectOk(r, 'jobPerdcomp.create');
  console.log('  perdcomp OK');

  console.log('--- jobInssNotes.upsert ---');
  r = await call(jobInssNotesCtrl.upsert, {
    params: { jobId: job.id },
    body: { avg_employees_last_12_months: 42, dctfweb_mandatory: true },
  });
  expectOk(r, 'jobInssNotes.upsert');
  console.log('  inss notes OK');

  console.log('--- jobReport.create + updateStatus ---');
  r = await call(jobReportCtrl.create, {
    params: { jobId: job.id },
    body: { tax_id: pisCofins.id, report_type: 'PARECER_CREDITO' },
    user: { id: user.id },
  });
  const report = expectOk(r, 'jobReport.create');
  r = await call(jobReportCtrl.updateStatus, { params: { jobId: job.id, id: report.id }, body: { status: 'finalizado' } });
  const updatedReport = expectOk(r, 'jobReport.updateStatus');
  assert.strictEqual(updatedReport.status, 'finalizado');
  assert.ok(updatedReport.conclusion_date);
  console.log('  report finalizado, conclusion_date =', updatedReport.conclusion_date);

  console.log('\n=== TODOS OS FLUXOS PASSARAM SEM ERROS ===');
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
