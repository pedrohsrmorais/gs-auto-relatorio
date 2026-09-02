const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/paginate');
const mergeUpdate = require('../utils/mergeUpdate');

const STATUSES = ['diagnostico', 'em_analise', 'revisao', 'parecer_emitido', 'concluido', 'cancelado'];
const TAX_REGIMES = ['Lucro Real', 'Lucro Presumido', 'Simples Nacional', 'Lucro Arbitrado'];
const TEAM_ROLES = [
  'responsavel_tecnico', 'gerente_tributario', 'coordenador_tributario', 'analista_fiscal',
  'gerente_previdenciario', 'coordenador_previdenciario', 'analista_previdenciario',
];

// GET /api/jobs
exports.list = asyncHandler(async (req, res) => {
  const { client_id, status, search } = req.query;
  const { page, limit, offset } = getPagination(req.query);

  const conditions = [];
  const params = [];

  if (client_id) { conditions.push('j.client_id = ?'); params.push(client_id); }
  if (status) { conditions.push('j.status = ?'); params.push(status); }
  if (search) { conditions.push('(j.job_number LIKE ? OR c.company_name LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT j.*, c.company_name, c.cnpj
     FROM jobs j
     JOIN clients c ON c.id = j.client_id
     ${where}
     ORDER BY j.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM jobs j JOIN clients c ON c.id = j.client_id ${where}`,
    params
  );

  sendSuccess(res, rows, { meta: buildMeta({ page, limit, total }) });
});

// GET /api/jobs/:id  (detalhe completo: cliente + equipe)
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT j.*, c.company_name, c.cnpj, c.segment AS client_segment
     FROM jobs j JOIN clients c ON c.id = j.client_id
     WHERE j.id = ?`,
    [req.params.id]
  );
  if (!rows.length) throw new ApiError(404, 'Job não encontrado.');

  const [team] = await pool.query(
    `SELECT jtm.id, jtm.role_in_job, u.id AS user_id, u.name, u.email
     FROM job_team_members jtm JOIN users u ON u.id = jtm.user_id
     WHERE jtm.job_id = ?`,
    [req.params.id]
  );

  sendSuccess(res, { ...rows[0], team });
});

// POST /api/jobs
exports.create = asyncHandler(async (req, res) => {
  const {
    job_number, client_id, period_start, period_end,
    tax_regime = null, segment = null,
  } = req.body;

  if (!job_number || !client_id || !period_start || !period_end) {
    throw new ApiError(400, 'job_number, client_id, period_start e period_end são obrigatórios.');
  }
  if (tax_regime && !TAX_REGIMES.includes(tax_regime)) {
    throw new ApiError(400, `tax_regime deve ser um de: ${TAX_REGIMES.join(', ')}.`);
  }

  const [client] = await pool.query('SELECT id FROM clients WHERE id = ?', [client_id]);
  if (!client.length) throw new ApiError(404, 'Cliente informado não existe.');

  const [existing] = await pool.query('SELECT id FROM jobs WHERE job_number = ?', [job_number]);
  if (existing.length) throw new ApiError(409, 'Já existe um Job com este número.');

  const [result] = await pool.query(
    `INSERT INTO jobs (job_number, client_id, period_start, period_end, tax_regime, segment, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [job_number, client_id, period_start, period_end, tax_regime, segment, req.user?.id ?? null]
  );

  const [rows] = await pool.query('SELECT * FROM jobs WHERE id = ?', [result.insertId]);
  sendCreated(res, rows[0]);
});

// PUT /api/jobs/:id
exports.update = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Job não encontrado.');

  const data = mergeUpdate(rows[0], req.body, [
    'period_start', 'period_end', 'tax_regime', 'segment',
  ]);

  await pool.query(
    `UPDATE jobs SET period_start = ?, period_end = ?, tax_regime = ?, segment = ? WHERE id = ?`,
    [data.period_start, data.period_end, data.tax_regime, data.segment, req.params.id]
  );

  const [updated] = await pool.query('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});

// PATCH /api/jobs/:id/status
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) {
    throw new ApiError(400, `status deve ser um de: ${STATUSES.join(', ')}.`);
  }

  const [rows] = await pool.query('SELECT id FROM jobs WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Job não encontrado.');

  await pool.query('UPDATE jobs SET status = ? WHERE id = ?', [status, req.params.id]);
  const [updated] = await pool.query('SELECT * FROM jobs WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});

// DELETE /api/jobs/:id
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id FROM jobs WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Job não encontrado.');

  // ON DELETE CASCADE no schema cuida de team_members, diagnostics,
  // analyses, usages, revenues, darf/sped/perdcomp e reports.
  await pool.query('DELETE FROM jobs WHERE id = ?', [req.params.id]);
  sendSuccess(res, null, { message: 'Job removido.' });
});

// --- Equipe do Job (job_team_members) -----------------------------------

// GET /api/jobs/:id/team
exports.listTeam = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT jtm.id, jtm.role_in_job, u.id AS user_id, u.name, u.email, u.job_title
     FROM job_team_members jtm JOIN users u ON u.id = jtm.user_id
     WHERE jtm.job_id = ?`,
    [req.params.id]
  );
  sendSuccess(res, rows);
});

// POST /api/jobs/:id/team
exports.addTeamMember = asyncHandler(async (req, res) => {
  const { user_id, role_in_job } = req.body;

  if (!user_id || !TEAM_ROLES.includes(role_in_job)) {
    throw new ApiError(400, `user_id é obrigatório e role_in_job deve ser um de: ${TEAM_ROLES.join(', ')}.`);
  }

  const [job] = await pool.query('SELECT id FROM jobs WHERE id = ?', [req.params.id]);
  if (!job.length) throw new ApiError(404, 'Job não encontrado.');

  const [user] = await pool.query('SELECT id FROM users WHERE id = ? AND is_active = TRUE', [user_id]);
  if (!user.length) throw new ApiError(404, 'Usuário informado não existe ou está inativo.');

  const [existing] = await pool.query(
    'SELECT id FROM job_team_members WHERE job_id = ? AND user_id = ? AND role_in_job = ?',
    [req.params.id, user_id, role_in_job]
  );
  if (existing.length) throw new ApiError(409, 'Este usuário já ocupa esse papel neste Job.');

  const [result] = await pool.query(
    'INSERT INTO job_team_members (job_id, user_id, role_in_job) VALUES (?, ?, ?)',
    [req.params.id, user_id, role_in_job]
  );

  sendCreated(res, { id: result.insertId, job_id: Number(req.params.id), user_id, role_in_job });
});

// DELETE /api/jobs/:id/team/:memberId
exports.removeTeamMember = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    'SELECT id FROM job_team_members WHERE id = ? AND job_id = ?',
    [req.params.memberId, req.params.id]
  );
  if (!rows.length) throw new ApiError(404, 'Vínculo de equipe não encontrado.');

  await pool.query('DELETE FROM job_team_members WHERE id = ?', [req.params.memberId]);
  sendSuccess(res, null, { message: 'Membro removido da equipe do Job.' });
});
