const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const mergeUpdate = require('../utils/mergeUpdate');

// Espelha a aba "UTILIZAÇÃO": um registro por mês de competência do Job,
// com os valores de restituição/ressarcimento/escritural quebrados por
// classificação de risco (verde/amarelo/vermelho).

const FIELDS = [
  'pis_credit', 'darf_collected', 'month_excess', 'balance_to_update', 'excess_used',
  'restitution_update_value', 'pct_untaxed_outputs', 'fintax_pis_credit',
  'restitution_total', 'restitution_green', 'restitution_yellow', 'restitution_red',
  'refund_total', 'refund_green', 'refund_yellow', 'refund_red',
  'bookkeeping_total', 'bookkeeping_green', 'bookkeeping_yellow', 'bookkeeping_red',
];

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

// GET /api/jobs/:jobId/credit-usages
exports.list = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { from, to } = req.query;

  const conditions = ['job_id = ?'];
  const params = [req.params.jobId];
  if (from) { conditions.push('reference_month >= ?'); params.push(normalizeMonth(from)); }
  if (to) { conditions.push('reference_month <= ?'); params.push(normalizeMonth(to)); }

  const [rows] = await pool.query(
    `SELECT * FROM job_credit_usages WHERE ${conditions.join(' AND ')} ORDER BY reference_month`,
    params
  );
  sendSuccess(res, rows);
});

// PUT /api/jobs/:jobId/credit-usages/:month  (upsert — YYYY-MM na URL)
exports.upsert = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const referenceMonth = normalizeMonth(req.params.month);

  const [existingRows] = await pool.query(
    'SELECT * FROM job_credit_usages WHERE job_id = ? AND reference_month = ?',
    [req.params.jobId, referenceMonth]
  );
  const current = existingRows[0] || Object.fromEntries(FIELDS.map((f) => [f, 0]));
  const data = mergeUpdate(current, req.body, FIELDS);

  const columns = ['job_id', 'reference_month', ...FIELDS];
  const placeholders = columns.map(() => '?').join(', ');
  const updateClause = FIELDS.map((field) => `${field} = VALUES(${field})`).join(', ');
  const values = [req.params.jobId, referenceMonth, ...FIELDS.map((f) => data[f])];

  await pool.query(
    `INSERT INTO job_credit_usages (${columns.join(', ')}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updateClause}`,
    values
  );

  const [rows] = await pool.query(
    'SELECT * FROM job_credit_usages WHERE job_id = ? AND reference_month = ?',
    [req.params.jobId, referenceMonth]
  );
  sendSuccess(res, rows[0]);
});

// POST /api/jobs/:jobId/credit-usages/bulk
// body: { entries: [{ reference_month, ...FIELDS }, ...] } — importa vários meses de uma vez
exports.bulkUpsert = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    throw new ApiError(400, 'entries deve ser um array não vazio.');
  }

  const columns = ['job_id', 'reference_month', ...FIELDS];
  const rows = entries.map((entry) => [
    req.params.jobId,
    normalizeMonth(entry.reference_month),
    ...FIELDS.map((f) => entry[f] ?? 0),
  ]);
  const updateClause = FIELDS.map((field) => `${field} = VALUES(${field})`).join(', ');

  await pool.query(
    `INSERT INTO job_credit_usages (${columns.join(', ')}) VALUES ?
     ON DUPLICATE KEY UPDATE ${updateClause}`,
    [rows]
  );

  const [saved] = await pool.query(
    'SELECT * FROM job_credit_usages WHERE job_id = ? ORDER BY reference_month', [req.params.jobId]
  );
  sendCreated(res, saved);
});

// DELETE /api/jobs/:jobId/credit-usages/:month
exports.remove = asyncHandler(async (req, res) => {
  const referenceMonth = normalizeMonth(req.params.month);
  const [rows] = await pool.query(
    'SELECT id FROM job_credit_usages WHERE job_id = ? AND reference_month = ?',
    [req.params.jobId, referenceMonth]
  );
  if (!rows.length) throw new ApiError(404, 'Registro de utilização não encontrado para este mês.');

  await pool.query('DELETE FROM job_credit_usages WHERE id = ?', [rows[0].id]);
  sendSuccess(res, null, { message: 'Registro de utilização removido.' });
});
