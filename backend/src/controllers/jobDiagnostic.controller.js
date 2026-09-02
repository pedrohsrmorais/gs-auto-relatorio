const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');

// job_diagnostics é 1:1 com jobs (aba "Diagnóstico" — as 8 perguntas
// fixas). Exposto como um único recurso "get/upsert" por Job, não como
// uma lista com CRUD completo.

const FIELDS = [
  'pays_darf',
  'avg_monthly_pis_cofins', 'avg_yearly_pis_cofins',
  'avg_monthly_irpj_csll', 'avg_yearly_irpj_csll',
  'avg_monthly_inss', 'avg_yearly_inss',
  'avg_monthly_ipi', 'avg_yearly_ipi',
  'collection_method', 'opportunities_above_500k', 'already_credits_risk_point',
  'has_debts_with_rfb', 'usage_plan', 'estimated_usage_months', 'observations',
];

async function assertJobExists(jobId) {
  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');
}

// GET /api/jobs/:jobId/diagnostic
exports.get = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);

  const [rows] = await pool.query('SELECT * FROM job_diagnostics WHERE job_id = ?', [req.params.jobId]);
  if (!rows.length) throw new ApiError(404, 'Diagnóstico ainda não preenchido para este Job.');

  sendSuccess(res, rows[0]);
});

// PUT /api/jobs/:jobId/diagnostic  (cria se não existir, atualiza se já existir)
exports.upsert = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);

  const values = FIELDS.map((field) => (req.body[field] === undefined ? null : req.body[field]));

  const columns = ['job_id', ...FIELDS];
  const placeholders = columns.map(() => '?').join(', ');
  const updateClause = FIELDS.map((field) => `${field} = VALUES(${field})`).join(', ');

  await pool.query(
    `INSERT INTO job_diagnostics (${columns.join(', ')}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updateClause}`,
    [req.params.jobId, ...values]
  );

  const [rows] = await pool.query('SELECT * FROM job_diagnostics WHERE job_id = ?', [req.params.jobId]);
  sendSuccess(res, rows[0]);
});
