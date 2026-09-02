const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/paginate');

// Espelha a aba "DARF" — normalmente centenas/milhares de linhas por Job,
// coladas a partir de relatórios da RFB. O fluxo principal é bulkImport,
// não create unitário.

const FIELDS = [
  'data_base', 'darf_code', 'collection_date', 'due_date', 'assessment_period',
  'revenue_code', 'name', 'document_number', 'total_value', 'days_late',
  'principal_value', 'fine_value', 'interest_value', 'tax_group', 'cnpj',
];

// Colunas NOT NULL DEFAULT 0 no schema — nunca podem receber null.
const NUMERIC_ZERO_DEFAULT_FIELDS = new Set([
  'total_value', 'days_late', 'principal_value', 'fine_value', 'interest_value',
]);

function fieldValue(source, field) {
  const value = source[field];
  if (value !== undefined && value !== null) return value;
  return NUMERIC_ZERO_DEFAULT_FIELDS.has(field) ? 0 : null;
}

async function assertJobExists(jobId) {
  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');
}

// GET /api/jobs/:jobId/darf-entries
exports.list = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { assessment_period, tax_group } = req.query;
  const { page, limit, offset } = getPagination(req.query, { defaultLimit: 50, maxLimit: 500 });

  const conditions = ['job_id = ?'];
  const params = [req.params.jobId];
  if (assessment_period) { conditions.push('assessment_period = ?'); params.push(assessment_period); }
  if (tax_group) { conditions.push('tax_group = ?'); params.push(tax_group); }

  const where = conditions.join(' AND ');
  const [rows] = await pool.query(
    `SELECT * FROM job_darf_entries WHERE ${where} ORDER BY data_base DESC LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM job_darf_entries WHERE ${where}`, params);

  sendSuccess(res, rows, { meta: buildMeta({ page, limit, total }) });
});

// GET /api/jobs/:jobId/darf-entries/:id
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM job_darf_entries WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Lançamento de DARF não encontrado.');
  sendSuccess(res, rows[0]);
});

// POST /api/jobs/:jobId/darf-entries  (lançamento único)
exports.create = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);

  const values = FIELDS.map((f) => fieldValue(req.body, f));
  const [result] = await pool.query(
    `INSERT INTO job_darf_entries (job_id, ${FIELDS.join(', ')}) VALUES (?, ${FIELDS.map(() => '?').join(', ')})`,
    [req.params.jobId, ...values]
  );

  const [rows] = await pool.query('SELECT * FROM job_darf_entries WHERE id = ?', [result.insertId]);
  sendCreated(res, rows[0]);
});

// POST /api/jobs/:jobId/darf-entries/bulk
// body: { entries: [{ data_base, darf_code, ... }, ...] }
exports.bulkImport = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { entries } = req.body;
  if (!Array.isArray(entries) || !entries.length) {
    throw new ApiError(400, 'entries deve ser um array não vazio.');
  }

  const rows = entries.map((entry) => [req.params.jobId, ...FIELDS.map((f) => fieldValue(entry, f))]);

  await pool.query(
    `INSERT INTO job_darf_entries (job_id, ${FIELDS.join(', ')}) VALUES ?`,
    [rows]
  );

  sendCreated(res, { imported: rows.length });
});

// PUT /api/jobs/:jobId/darf-entries/:id
exports.update = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM job_darf_entries WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Lançamento de DARF não encontrado.');

  const values = FIELDS.map((f) => (req.body[f] !== undefined ? req.body[f] : rows[0][f]));
  await pool.query(
    `UPDATE job_darf_entries SET ${FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`,
    [...values, req.params.id]
  );

  const [updated] = await pool.query('SELECT * FROM job_darf_entries WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});

// DELETE /api/jobs/:jobId/darf-entries/:id
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id FROM job_darf_entries WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Lançamento de DARF não encontrado.');

  await pool.query('DELETE FROM job_darf_entries WHERE id = ?', [req.params.id]);
  sendSuccess(res, null, { message: 'Lançamento removido.' });
});

// DELETE /api/jobs/:jobId/darf-entries  (limpa tudo para reimportar do zero)
exports.removeAllForJob = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const [result] = await pool.query('DELETE FROM job_darf_entries WHERE job_id = ?', [req.params.jobId]);
  sendSuccess(res, null, { message: `${result.affectedRows} lançamento(s) removido(s).` });
});
