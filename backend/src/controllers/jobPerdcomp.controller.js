const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const mergeUpdate = require('../utils/mergeUpdate');

const STATUSES = ['EM_ANALISE', 'HOMOLOGADA', 'NAO_HOMOLOGADA', 'CANCELADA', 'RETIFICADA'];

async function assertJobExists(jobId) {
  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');
}

// GET /api/jobs/:jobId/perdcomps
exports.list = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const { status } = req.query;

  const conditions = ['job_id = ?'];
  const params = [req.params.jobId];
  if (status) { conditions.push('status = ?'); params.push(status); }

  const [rows] = await pool.query(
    `SELECT * FROM job_perdcomps WHERE ${conditions.join(' AND ')} ORDER BY transmission_date DESC`,
    params
  );
  sendSuccess(res, rows);
});

// GET /api/jobs/:jobId/perdcomps/:id
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM job_perdcomps WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'PER/DCOMP não encontrado.');
  sendSuccess(res, rows[0]);
});

// POST /api/jobs/:jobId/perdcomps
exports.create = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);
  const {
    perdcomp_number, transmission_date = null, credit_type = null,
    document_type = null, status = 'EM_ANALISE',
  } = req.body;

  if (!perdcomp_number) throw new ApiError(400, 'perdcomp_number é obrigatório.');
  if (!STATUSES.includes(status)) throw new ApiError(400, `status deve ser um de: ${STATUSES.join(', ')}.`);

  const [existing] = await pool.query('SELECT id FROM job_perdcomps WHERE perdcomp_number = ?', [perdcomp_number]);
  if (existing.length) throw new ApiError(409, 'Já existe um PER/DCOMP com este número.');

  const [result] = await pool.query(
    `INSERT INTO job_perdcomps (job_id, perdcomp_number, transmission_date, credit_type, document_type, status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [req.params.jobId, perdcomp_number, transmission_date, credit_type, document_type, status]
  );

  const [rows] = await pool.query('SELECT * FROM job_perdcomps WHERE id = ?', [result.insertId]);
  sendCreated(res, rows[0]);
});

// PUT /api/jobs/:jobId/perdcomps/:id
exports.update = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT * FROM job_perdcomps WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'PER/DCOMP não encontrado.');

  const data = mergeUpdate(rows[0], req.body, [
    'transmission_date', 'credit_type', 'document_type', 'status',
  ]);
  if (!STATUSES.includes(data.status)) throw new ApiError(400, `status deve ser um de: ${STATUSES.join(', ')}.`);

  await pool.query(
    `UPDATE job_perdcomps SET transmission_date = ?, credit_type = ?, document_type = ?, status = ? WHERE id = ?`,
    [data.transmission_date, data.credit_type, data.document_type, data.status, req.params.id]
  );

  const [updated] = await pool.query('SELECT * FROM job_perdcomps WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});

// DELETE /api/jobs/:jobId/perdcomps/:id
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id FROM job_perdcomps WHERE id = ? AND job_id = ?', [req.params.id, req.params.jobId]
  );
  if (!rows.length) throw new ApiError(404, 'PER/DCOMP não encontrado.');

  await pool.query('DELETE FROM job_perdcomps WHERE id = ?', [req.params.id]);
  sendSuccess(res, null, { message: 'PER/DCOMP removido.' });
});
