const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const mergeUpdate = require('../utils/mergeUpdate');

// Espelha as abas "PARECER NÃO CRÉDITO" / "PARECER NÃO CRÉDITO IRCS/IPI/INSS"
// — controla o ciclo de vida do documento final entregue ao cliente
// (o próprio arquivo PDF/DOCX fica fora do banco, referenciado por file_path;
// ver skill de geração de documentos para produzir o arquivo em si).

const REPORT_TYPES = ['PARECER_CREDITO', 'PARECER_NAO_CREDITO'];
const STATUSES = ['rascunho', 'finalizado', 'assinado'];

async function assertJobExists(jobId) {
  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');
}

// GET /api/jobs/:jobId/reports
exports.list = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { status, tax_id } = req.query;

  const conditions = ['jr.job_id = ?'];
  const params = [req.params.jobId];
  if (status) { conditions.push('jr.status = ?'); params.push(status); }
  if (tax_id) { conditions.push('jr.tax_id = ?'); params.push(tax_id); }

  const [rows] = await pool.query(
    `SELECT jr.*, t.name AS tax_name, u.name AS responsible_name
     FROM job_reports jr
     LEFT JOIN taxes t ON t.id = jr.tax_id
     LEFT JOIN users u ON u.id = jr.responsible_user_id
     WHERE ${conditions.join(' AND ')}
     ORDER BY jr.created_at DESC`,
    params
  );
  sendSuccess(res, rows);
});

// GET /api/jobs/:jobId/reports/:id
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM job_reports WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Parecer não encontrado.');
  sendSuccess(res, rows[0]);
});

// POST /api/jobs/:jobId/reports
exports.create = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { tax_id = null, report_type, responsible_user_id = null } = req.body;

  if (!REPORT_TYPES.includes(report_type)) {
    throw new ApiError(400, `report_type deve ser um de: ${REPORT_TYPES.join(', ')}.`);
  }

  const [result] = await pool.query(
    `INSERT INTO job_reports (job_id, tax_id, report_type, responsible_user_id, status)
     VALUES (?, ?, ?, ?, 'rascunho')`,
    [req.params.jobId, tax_id, report_type, responsible_user_id ?? req.user?.id ?? null]
  );

  const [rows] = await pool.query('SELECT * FROM job_reports WHERE id = ?', [result.insertId]);
  sendCreated(res, rows[0]);
});

// PUT /api/jobs/:jobId/reports/:id
exports.update = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM job_reports WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Parecer não encontrado.');

  const data = mergeUpdate(rows[0], req.body, [
    'tax_id', 'report_type', 'conclusion_date', 'responsible_user_id', 'file_path',
  ]);
  if (!REPORT_TYPES.includes(data.report_type)) {
    throw new ApiError(400, `report_type deve ser um de: ${REPORT_TYPES.join(', ')}.`);
  }

  await pool.query(
    `UPDATE job_reports SET tax_id = ?, report_type = ?, conclusion_date = ?, responsible_user_id = ?, file_path = ?
     WHERE id = ?`,
    [data.tax_id, data.report_type, data.conclusion_date, data.responsible_user_id, data.file_path, req.params.id]
  );

  const [updated] = await pool.query('SELECT * FROM job_reports WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});

// PATCH /api/jobs/:jobId/reports/:id/status
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) throw new ApiError(400, `status deve ser um de: ${STATUSES.join(', ')}.`);

  const [rows] = await pool.query(
    'SELECT id FROM job_reports WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Parecer não encontrado.');

  const conclusionDate = status === 'finalizado' ? new Date() : undefined;
  await pool.query(
    `UPDATE job_reports SET status = ?, conclusion_date = COALESCE(?, conclusion_date) WHERE id = ?`,
    [status, conclusionDate ?? null, req.params.id]
  );

  const [updated] = await pool.query('SELECT * FROM job_reports WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});

// DELETE /api/jobs/:jobId/reports/:id
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id FROM job_reports WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'Parecer não encontrado.');

  await pool.query('DELETE FROM job_reports WHERE id = ?', [req.params.id]);
  sendSuccess(res, null, { message: 'Parecer removido.' });
});
