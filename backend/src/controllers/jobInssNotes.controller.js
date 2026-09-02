const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');

// Espelha a aba "Observações Técnicas INSS" — 1:1 com o Job, mesmo
// padrão get/upsert de job_diagnostics.

const FIELDS = [
  'avg_monthly_social_security_debts', 'avg_monthly_tax_debts', 'avg_employees_last_12_months',
  'payroll_tax_relief_last_60_months', 'simples_nacional_last_60_months', 'dctfweb_mandatory',
  'power_of_attorney_expiration', 'has_esocial_dctfweb_perdcomp_access',
];

async function assertJobExists(jobId) {
  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [jobId]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');
}

// GET /api/jobs/:jobId/inss-notes
exports.get = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);

  const [rows] = await pool.query('SELECT * FROM job_inss_technical_notes WHERE job_id = ?', [req.params.jobId]);
  if (!rows.length) throw new ApiError(404, 'Observações técnicas de INSS ainda não preenchidas para este Job.');

  sendSuccess(res, rows[0]);
});

// PUT /api/jobs/:jobId/inss-notes  (cria se não existir, atualiza se já existir)
exports.upsert = asyncHandler(async (req, res) => {
  await assertJobExists(req.params.jobId);

  const values = FIELDS.map((field) => (req.body[field] === undefined ? null : req.body[field]));
  const columns = ['job_id', ...FIELDS];
  const placeholders = columns.map(() => '?').join(', ');
  const updateClause = FIELDS.map((field) => `${field} = VALUES(${field})`).join(', ');

  await pool.query(
    `INSERT INTO job_inss_technical_notes (${columns.join(', ')}) VALUES (${placeholders})
     ON DUPLICATE KEY UPDATE ${updateClause}`,
    [req.params.jobId, ...values]
  );

  const [rows] = await pool.query('SELECT * FROM job_inss_technical_notes WHERE job_id = ?', [req.params.jobId]);
  sendSuccess(res, rows[0]);
});
