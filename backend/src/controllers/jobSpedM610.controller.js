const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/paginate');

// Espelha a aba "M610" (SPED Contribuições — apuração da contribuição
// social/COFINS). Mesmo padrão de importação em massa do M400.

const FIELDS = [
  'reference_month', 'establishment', 'contribution_code', 'contribution_description',
  'gross_revenue_value', 'calculation_base_value', 'pis_aliquot', 'pis_quantity',
  'pis_quantity_aliquot', 'total_contribution_calculated', 'addition_adjustments_value',
  'reduction_adjustments_value', 'deferred_contribution_value',
  'previous_deferred_contribution_value', 'total_period_contribution_value',
  'bookkeeping_type', 'data_base',
];

function normalizeMonth(value) {
  const match = String(value || '').match(/^(\d{4})-(\d{2})/);
  if (!match) throw new ApiError(400, 'reference_month inválido — use o formato YYYY-MM.');
  return `${match[1]}-${match[2]}-01`;
}

async function assertJobExists(jobId) {
  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');
}

// GET /api/jobs/:jobId/sped-m610
exports.list = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { from, to } = req.query;
  const { page, limit, offset } = getPagination(req.query, { defaultLimit: 50, maxLimit: 500 });

  const conditions = ['job_id = ?'];
  const params = [req.params.jobId];
  if (from) { conditions.push('reference_month >= ?'); params.push(normalizeMonth(from)); }
  if (to) { conditions.push('reference_month <= ?'); params.push(normalizeMonth(to)); }

  const where = conditions.join(' AND ');
  const [rows] = await pool.query(
    `SELECT * FROM job_sped_m610_entries WHERE ${where} ORDER BY reference_month LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM job_sped_m610_entries WHERE ${where}`, params);

  sendSuccess(res, rows, { meta: buildMeta({ page, limit, total }) });
});

// POST /api/jobs/:jobId/sped-m610/bulk
exports.bulkImport = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    throw new ApiError(400, 'entries deve ser um array não vazio.');
  }

  const rows = entries.map((entry) => [
    req.params.jobId,
    normalizeMonth(entry.reference_month),
    entry.establishment ?? null,
    entry.contribution_code ?? null,
    entry.contribution_description ?? null,
    entry.gross_revenue_value ?? 0,
    entry.calculation_base_value ?? 0,
    entry.pis_aliquot ?? 0,
    entry.pis_quantity ?? 0,
    entry.pis_quantity_aliquot ?? 0,
    entry.total_contribution_calculated ?? 0,
    entry.addition_adjustments_value ?? 0,
    entry.reduction_adjustments_value ?? 0,
    entry.deferred_contribution_value ?? 0,
    entry.previous_deferred_contribution_value ?? 0,
    entry.total_period_contribution_value ?? 0,
    entry.bookkeeping_type ?? null,
    entry.data_base ?? null,
  ]);

  await pool.query(
    `INSERT INTO job_sped_m610_entries (job_id, ${FIELDS.join(', ')}) VALUES ?`,
    [rows]
  );

  sendCreated(res, { imported: rows.length });
});

// DELETE /api/jobs/:jobId/sped-m610/:id
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id FROM job_sped_m610_entries WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Registro M610 não encontrado.');

  await pool.query('DELETE FROM job_sped_m610_entries WHERE id = ?', [req.params.id]);
  sendSuccess(res, null, { message: 'Registro removido.' });
});

// DELETE /api/jobs/:jobId/sped-m610  (limpa tudo para reimportar)
exports.removeAllForJob = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const [result] = await pool.query('DELETE FROM job_sped_m610_entries WHERE job_id = ?', [req.params.jobId]);
  sendSuccess(res, null, { message: `${result.affectedRows} registro(s) removido(s).` });
});
