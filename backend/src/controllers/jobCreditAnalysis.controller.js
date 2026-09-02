const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');

// Este é o controller do "input principal do operador": para cada Job,
// cada ponto de crédito do catálogo pode ser marcado como aproveitável,
// com observações e uma série mensal de valores (aba CREDITOS — PIS e
// COFINS separados). Equivale à combinação das abas INICIO + CREDITOS.

const CONTRIBUTIONS = ['PIS', 'COFINS'];

async function assertJobExists(jobId) {
  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');
}

async function getAnalysisOrThrow(jobId, analysisId) {
  const [rows] = await pool.query(
    'SELECT * FROM job_credit_point_analyses WHERE id = ? AND job_id = ?',
    [analysisId, jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Análise de ponto de crédito não encontrada.');
  return rows[0];
}

// Mantém total_credit_value sincronizado com a soma dos valores mensais.
async function recalculateTotal(analysisId) {
  const [[{ total }]] = await pool.query(
    'SELECT COALESCE(SUM(value), 0) AS total FROM job_credit_monthly_values WHERE job_credit_point_analysis_id = ?',
    [analysisId]
  );
  await pool.query('UPDATE job_credit_point_analyses SET total_credit_value = ? WHERE id = ?', [total, analysisId]);
  return total;
}

// GET /api/jobs/:jobId/credit-analyses
exports.list = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { category, risk_color, has_credit } = req.query;

  const conditions = ['jcpa.job_id = ?'];
  const params = [req.params.jobId];

  if (category) { conditions.push('cp.category = ?'); params.push(category); }
  if (risk_color) { conditions.push('cp.risk_color = ?'); params.push(risk_color); }
  if (has_credit !== undefined) { conditions.push('jcpa.has_credit = ?'); params.push(has_credit === 'true' ? 1 : 0); }

  const [rows] = await pool.query(
    `SELECT jcpa.*, cp.name AS credit_point_name, cp.category, cp.risk_color, t.code AS tax_code
     FROM job_credit_point_analyses jcpa
     JOIN credit_points cp ON cp.id = jcpa.credit_point_id
     JOIN taxes t ON t.id = cp.tax_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY t.id, cp.name`,
    params
  );

  sendSuccess(res, rows);
});

// GET /api/jobs/:jobId/credit-analyses/:analysisId
exports.getById = asyncHandler(async (req, res) => {
  const analysis = await getAnalysisOrThrow(req.params.jobId, req.params.analysisId);

  const [monthlyValues] = await pool.query(
    'SELECT * FROM job_credit_monthly_values WHERE job_credit_point_analysis_id = ? ORDER BY reference_month, contribution',
    [analysis.id]
  );

  sendSuccess(res, { ...analysis, monthlyValues });
});

// PUT /api/jobs/:jobId/credit-analyses/:creditPointId
// Upsert por credit_point_id (não por id da análise) — reflete o fluxo
// real: o operador abre o ponto "Energia Elétrica" do Job e preenche.
exports.upsertByCreditPoint = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { creditPointId } = req.params;
  const { has_credit = false, observations = null } = req.body;

  const [creditPoint] = await pool.query('SELECT id FROM credit_points WHERE id = ?', [creditPointId]);
  if (!creditPoint.length) throw new ApiError(404, 'Ponto de crédito não encontrado no catálogo.');

  await pool.query(
    `INSERT INTO job_credit_point_analyses (job_id, credit_point_id, has_credit, observations, analyzed_by, analyzed_at)
     VALUES (?, ?, ?, ?, ?, NOW())
     ON DUPLICATE KEY UPDATE
       has_credit = VALUES(has_credit),
       observations = VALUES(observations),
       analyzed_by = VALUES(analyzed_by),
       analyzed_at = NOW()`,
    [req.params.jobId, creditPointId, !!has_credit, observations, req.user?.id ?? null]
  );

  const [rows] = await pool.query(
    'SELECT * FROM job_credit_point_analyses WHERE job_id = ? AND credit_point_id = ?',
    [req.params.jobId, creditPointId]
  );
  sendSuccess(res, rows[0]);
});

// DELETE /api/jobs/:jobId/credit-analyses/:analysisId
exports.remove = asyncHandler(async (req, res) => {
  await getAnalysisOrThrow(req.params.jobId, req.params.analysisId);
  // ON DELETE CASCADE remove os valores mensais associados.
  await pool.query('DELETE FROM job_credit_point_analyses WHERE id = ?', [req.params.analysisId]);
  sendSuccess(res, null, { message: 'Análise removida.' });
});

// --- Valores mensais (job_credit_monthly_values) ------------------------

// PUT /api/jobs/:jobId/credit-analyses/:analysisId/months/:month
// :month no formato YYYY-MM-DD (dia 01) ou YYYY-MM
exports.setMonthlyValue = asyncHandler(async (req, res) => {
  const analysis = await getAnalysisOrThrow(req.params.jobId, req.params.analysisId);
  const { contribution = null, value } = req.body;

  if (value === undefined || Number.isNaN(Number(value))) {
    throw new ApiError(400, 'value numérico é obrigatório.');
  }
  if (contribution && !CONTRIBUTIONS.includes(contribution)) {
    throw new ApiError(400, `contribution deve ser um de: ${CONTRIBUTIONS.join(', ')}.`);
  }

  const referenceMonth = normalizeMonth(req.params.month);

  await pool.query(
    `INSERT INTO job_credit_monthly_values (job_credit_point_analysis_id, contribution, reference_month, value)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [analysis.id, contribution, referenceMonth, value]
  );

  const total = await recalculateTotal(analysis.id);
  sendSuccess(res, { job_credit_point_analysis_id: analysis.id, contribution, reference_month: referenceMonth, value, total_credit_value: total });
});

// POST /api/jobs/:jobId/credit-analyses/:analysisId/months/bulk
// Importa vários meses de uma vez (ex: colar a linha inteira 2021-2026 da planilha)
// body: { entries: [{ contribution, reference_month, value }, ...] }
exports.bulkSetMonthlyValues = asyncHandler(async (req, res) => {
  const analysis = await getAnalysisOrThrow(req.params.jobId, req.params.analysisId);
  const { entries } = req.body;

  if (!Array.isArray(entries) || !entries.length) {
    throw new ApiError(400, 'entries deve ser um array não vazio.');
  }

  const rows = entries.map((entry) => {
    if (entry.value === undefined || Number.isNaN(Number(entry.value))) {
      throw new ApiError(400, 'Cada entrada precisa de um value numérico.');
    }
    if (entry.contribution && !CONTRIBUTIONS.includes(entry.contribution)) {
      throw new ApiError(400, `contribution deve ser um de: ${CONTRIBUTIONS.join(', ')}.`);
    }
    return [analysis.id, entry.contribution ?? null, normalizeMonth(entry.reference_month), entry.value];
  });

  await pool.query(
    `INSERT INTO job_credit_monthly_values (job_credit_point_analysis_id, contribution, reference_month, value)
     VALUES ?
     ON DUPLICATE KEY UPDATE value = VALUES(value)`,
    [rows]
  );

  const total = await recalculateTotal(analysis.id);
  const [monthlyValues] = await pool.query(
    'SELECT * FROM job_credit_monthly_values WHERE job_credit_point_analysis_id = ? ORDER BY reference_month, contribution',
    [analysis.id]
  );

  sendCreated(res, { total_credit_value: total, monthlyValues });
});

// DELETE /api/jobs/:jobId/credit-analyses/:analysisId/months/:valueId
exports.removeMonthlyValue = asyncHandler(async (req, res) => {
  const analysis = await getAnalysisOrThrow(req.params.jobId, req.params.analysisId);

  const [rows] = await pool.query(
    'SELECT id FROM job_credit_monthly_values WHERE id = ? AND job_credit_point_analysis_id = ?',
    [req.params.valueId, analysis.id]
  );
  if (!rows.length) throw new ApiError(404, 'Valor mensal não encontrado.');

  await pool.query('DELETE FROM job_credit_monthly_values WHERE id = ?', [req.params.valueId]);
  const total = await recalculateTotal(analysis.id);

  sendSuccess(res, { total_credit_value: total }, { message: 'Valor mensal removido.' });
});

function normalizeMonth(value) {
  if (!value) throw new ApiError(400, 'reference_month é obrigatório (formato YYYY-MM ou YYYY-MM-DD).');
  const match = String(value).match(/^(\d{4})-(\d{2})/);
  if (!match) throw new ApiError(400, 'reference_month inválido — use o formato YYYY-MM.');
  return `${match[1]}-${match[2]}-01`;
}
