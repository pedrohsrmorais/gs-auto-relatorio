const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/paginate');

// Espelha a aba "M400" (SPED Contribuições — detalhamento de receitas
// com CST 04 a 09). Registros de importação: normalmente reimportados
// por completo a cada nova versão do SPED, não editados linha a linha.

const FIELDS = [
  'reference_month', 'establishment', 'reg', 'cst', 'gross_revenue_value',
  'accounting_account_code', 'revenue_description', 'bookkeeping_type', 'data_base',
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

// GET /api/jobs/:jobId/sped-m400
exports.list = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { from, to, cst } = req.query;
  const { page, limit, offset } = getPagination(req.query, { defaultLimit: 50, maxLimit: 500 });

  const conditions = ['job_id = ?'];
  const params = [req.params.jobId];
  if (from) { conditions.push('reference_month >= ?'); params.push(normalizeMonth(from)); }
  if (to) { conditions.push('reference_month <= ?'); params.push(normalizeMonth(to)); }
  if (cst) { conditions.push('cst = ?'); params.push(cst); }

  const where = conditions.join(' AND ');
  const [rows] = await pool.query(
    `SELECT * FROM job_sped_m400_entries WHERE ${where} ORDER BY reference_month LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM job_sped_m400_entries WHERE ${where}`, params);

  sendSuccess(res, rows, { meta: buildMeta({ page, limit, total }) });
});

// POST /api/jobs/:jobId/sped-m400/bulk
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
    entry.reg ?? null,
    entry.cst ?? null,
    entry.gross_revenue_value ?? 0,
    entry.accounting_account_code ?? null,
    entry.revenue_description ?? null,
    entry.bookkeeping_type ?? null,
    entry.data_base ?? null,
  ]);

  await pool.query(
    `INSERT INTO job_sped_m400_entries (job_id, ${FIELDS.join(', ')}) VALUES ?`,
    [rows]
  );

  sendCreated(res, { imported: rows.length });
});

// DELETE /api/jobs/:jobId/sped-m400/:id
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id FROM job_sped_m400_entries WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Registro M400 não encontrado.');

  await pool.query('DELETE FROM job_sped_m400_entries WHERE id = ?', [req.params.id]);
  sendSuccess(res, null, { message: 'Registro removido.' });
});

// DELETE /api/jobs/:jobId/sped-m400  (limpa tudo para reimportar)
exports.removeAllForJob = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const [result] = await pool.query('DELETE FROM job_sped_m400_entries WHERE job_id = ?', [req.params.jobId]);
  sendSuccess(res, null, { message: `${result.affectedRows} registro(s) removido(s).` });
});
