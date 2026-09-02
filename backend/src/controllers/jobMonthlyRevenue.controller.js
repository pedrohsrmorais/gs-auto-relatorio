const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');

// Espelha a aba "% DE RECEITAS RET": receitas tributadas x não tributadas
// por mês, usadas como critério de rateio dos créditos apurados.
// total_revenue é coluna GERADA no banco (taxed + untaxed) — não é
// enviada pela API, apenas lida de volta.

function normalizeMonth(value) {
  if (!value) throw new ApiError(400, 'reference_month é obrigatório (formato YYYY-MM).');
  const match = String(value).match(/^(\d{4})-(\d{2})/);
  if (!match) throw new ApiError(400, 'reference_month inválido — use o formato YYYY-MM.');
  return `${match[1]}-${match[2]}-01`;
}

async function assertJobExists(jobId) {
  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');
}

// GET /api/jobs/:jobId/monthly-revenues
exports.list = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const [rows] = await pool.query(
    'SELECT * FROM job_monthly_revenues WHERE job_id = ? ORDER BY reference_month',
    [req.params.jobId]
  );
  sendSuccess(res, rows);
});

// PUT /api/jobs/:jobId/monthly-revenues/:month  (upsert)
exports.upsert = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const referenceMonth = normalizeMonth(req.params.month);
  const { taxed_revenue = 0, untaxed_revenue = 0, pct_untaxed_outputs = 0 } = req.body;

  await pool.query(
    `INSERT INTO job_monthly_revenues (job_id, reference_month, taxed_revenue, untaxed_revenue, pct_untaxed_outputs)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       taxed_revenue = VALUES(taxed_revenue),
       untaxed_revenue = VALUES(untaxed_revenue),
       pct_untaxed_outputs = VALUES(pct_untaxed_outputs)`,
    [req.params.jobId, referenceMonth, taxed_revenue, untaxed_revenue, pct_untaxed_outputs]
  );

  const [rows] = await pool.query(
    'SELECT * FROM job_monthly_revenues WHERE job_id = ? AND reference_month = ?',
    [req.params.jobId, referenceMonth]
  );
  sendSuccess(res, rows[0]);
});

// POST /api/jobs/:jobId/monthly-revenues/bulk
exports.bulkUpsert = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    throw new ApiError(400, 'entries deve ser um array não vazio.');
  }

  const rows = entries.map((entry) => [
    req.params.jobId,
    normalizeMonth(entry.reference_month),
    entry.taxed_revenue ?? 0,
    entry.untaxed_revenue ?? 0,
    entry.pct_untaxed_outputs ?? 0,
  ]);

  await pool.query(
    `INSERT INTO job_monthly_revenues (job_id, reference_month, taxed_revenue, untaxed_revenue, pct_untaxed_outputs)
     VALUES ?
     ON DUPLICATE KEY UPDATE
       taxed_revenue = VALUES(taxed_revenue),
       untaxed_revenue = VALUES(untaxed_revenue),
       pct_untaxed_outputs = VALUES(pct_untaxed_outputs)`,
    [rows]
  );

  const [saved] = await pool.query(
    'SELECT * FROM job_monthly_revenues WHERE job_id = ? ORDER BY reference_month', [req.params.jobId]
  );
  sendCreated(res, saved);
});

// DELETE /api/jobs/:jobId/monthly-revenues/:month
exports.remove = asyncHandler(async (req, res) => {
  const referenceMonth = normalizeMonth(req.params.month);
  const [rows] = await pool.query(
    'SELECT id FROM job_monthly_revenues WHERE job_id = ? AND reference_month = ?',
    [req.params.jobId, referenceMonth]
  );
  if (!rows.length) throw new ApiError(404, 'Registro de receita não encontrado para este mês.');

  await pool.query('DELETE FROM job_monthly_revenues WHERE id = ?', [rows[0].id]);
  sendSuccess(res, null, { message: 'Registro de receita removido.' });
});
