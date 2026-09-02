const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/paginate');
const mergeUpdate = require('../utils/mergeUpdate');

// Gestão de contas (equipe do Grupo Studio). Rotas deste controller devem
// ser protegidas com authorize('admin') — exceção: getById também é usado
// para exibir "quem é o gerente/analista" de um Job, então pode ser aberto
// a qualquer usuário autenticado, a critério da rota.

const SAFE_FIELDS = `
  id, name, email, role, job_title, has_signature, signature_file_path,
  is_active, last_login_at, created_at, updated_at
`;

// GET /api/users
exports.list = asyncHandler(async (req, res) => {
  const { role, job_title, is_active, search } = req.query;
  const { page, limit, offset } = getPagination(req.query);

  const conditions = [];
  const params = [];

  if (role) { conditions.push('role = ?'); params.push(role); }
  if (job_title) { conditions.push('job_title = ?'); params.push(job_title); }
  if (is_active !== undefined) { conditions.push('is_active = ?'); params.push(is_active === 'true' ? 1 : 0); }
  if (search) { conditions.push('(name LIKE ? OR email LIKE ?)'); params.push(`%${search}%`, `%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT ${SAFE_FIELDS} FROM users ${where} ORDER BY name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users ${where}`, params);

  sendSuccess(res, rows, { meta: buildMeta({ page, limit, total }) });
});

// GET /api/users/:id
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`, [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Usuário não encontrado.');
  sendSuccess(res, rows[0]);
});

// POST /api/users  (admin)
exports.create = asyncHandler(async (req, res) => {
  const { name, email, password, role = 'user', job_title = null, has_signature = false } = req.body;

  if (!name || !email || !password) {
    throw new ApiError(400, 'name, email e password são obrigatórios.');
  }
  if (!['admin', 'user'].includes(role)) {
    throw new ApiError(400, 'role deve ser "admin" ou "user".');
  }
  if (password.length < 8) {
    throw new ApiError(400, 'A senha deve ter ao menos 8 caracteres.');
  }

  const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) throw new ApiError(409, 'Já existe um usuário com este e-mail.');

  const passwordHash = await bcrypt.hash(password, 12);

  const [result] = await pool.query(
    `INSERT INTO users (name, email, password_hash, role, job_title, has_signature)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [name, email, passwordHash, role, job_title, !!has_signature]
  );

  const [rows] = await pool.query(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`, [result.insertId]);
  sendCreated(res, rows[0]);
});

// PUT /api/users/:id  (dados de perfil — não altera senha nem role)
exports.update = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Usuário não encontrado.');

  const data = mergeUpdate(rows[0], req.body, [
    'name', 'job_title', 'has_signature', 'signature_file_path', 'is_active',
  ]);

  await pool.query(
    `UPDATE users SET name = ?, job_title = ?, has_signature = ?, signature_file_path = ?, is_active = ?
     WHERE id = ?`,
    [data.name, data.job_title, !!data.has_signature, data.signature_file_path, !!data.is_active, req.params.id]
  );

  const [updated] = await pool.query(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`, [req.params.id]);
  sendSuccess(res, updated[0]);
});

// PATCH /api/users/:id/role  (admin — endpoint isolado para evitar
// escalonamento de privilégio acidental via update genérico)
exports.updateRole = asyncHandler(async (req, res) => {
  const { role } = req.body;
  if (!['admin', 'user'].includes(role)) {
    throw new ApiError(400, 'role deve ser "admin" ou "user".');
  }

  const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Usuário não encontrado.');

  if (Number(req.params.id) === req.user.id && role !== 'admin') {
    throw new ApiError(400, 'Você não pode remover seu próprio acesso de admin.');
  }

  await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
  const [updated] = await pool.query(`SELECT ${SAFE_FIELDS} FROM users WHERE id = ?`, [req.params.id]);
  sendSuccess(res, updated[0]);
});

// DELETE /api/users/:id  (admin — soft delete: desativa em vez de apagar,
// pois o usuário pode estar referenciado em jobs/análises/pareceres)
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id FROM users WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Usuário não encontrado.');

  await pool.query('UPDATE users SET is_active = FALSE WHERE id = ?', [req.params.id]);
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [req.params.id]
  );

  sendSuccess(res, null, { message: 'Usuário desativado.' });
});
