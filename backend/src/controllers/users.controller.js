const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

/* =====================================================================
 * users.controller.js — gestão de contas (admin-only).
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

async function logAction(req, { action, entityType = null, entityId = null, jobId = null, details = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, job_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [req.user?.id ?? null, action, entityType, entityId, jobId, details ? JSON.stringify(details) : null, req.ip ?? null]
    );
  } catch (err) {
    console.error('Falha ao registrar log de auditoria:', err);
  }
}

function toPublicUser(row) {
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    role: row.role,
    job_title: row.job_title,
    has_signature: !!row.has_signature,
    signature_file_path: row.signature_file_path,
    is_active: !!row.is_active,
    last_login_at: row.last_login_at,
  };
}

function getPagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

async function list(req, res, next) {
  try {
    const { search, role, is_active } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    const where = [];
    const params = [];
    if (search) { where.push(`(name LIKE ? OR email LIKE ?)`); params.push(`%${search}%`, `%${search}%`); }
    if (role) { where.push(`role = ?`); params.push(role); }
    if (is_active !== undefined) { where.push(`is_active = ?`); params.push(is_active === 'true' ? 1 : 0); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM users ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM users ${whereSql} ORDER BY name ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ data: rows.map(toPublicUser), total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { name, email, password, role = 'user', job_title } = req.body;
    if (!name || !email || !password || password.length < 8) {
      throw new ApiError(400, 'Nome, e-mail e senha (mín. 8 caracteres) são obrigatórios.');
    }

    const [existing] = await pool.query(`SELECT id FROM users WHERE email = ? LIMIT 1`, [email]);
    if (existing.length > 0) throw new ApiError(409, 'Já existe um usuário com esse e-mail.');

    const passwordHash = await bcrypt.hash(password, 12);
    const [result] = await pool.query(
      `INSERT INTO users (name, email, password_hash, role, job_title) VALUES (?, ?, ?, ?, ?)`,
      [name, email, passwordHash, role, job_title || null]
    );

    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [result.insertId]);

    await logAction(req, {
      action: 'USER_CREATED', entityType: 'user', entityId: result.insertId,
      details: { name, email, role, job_title: job_title || null },
    });

    res.status(201).json({ data: toPublicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
}

async function update(req, res, next) {
  try {
    const { id } = req.params;
    const { name, job_title, has_signature, is_active } = req.body;

    const fields = [];
    const params = [];
    if (name !== undefined) { fields.push('name = ?'); params.push(name); }
    if (job_title !== undefined) { fields.push('job_title = ?'); params.push(job_title || null); }
    if (has_signature !== undefined) { fields.push('has_signature = ?'); params.push(has_signature ? 1 : 0); }
    if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active ? 1 : 0); }
    if (fields.length === 0) throw new ApiError(400, 'Nenhum campo para atualizar.');

    params.push(id);
    await pool.query(`UPDATE users SET ${fields.join(', ')} WHERE id = ?`, params);

    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [id]);
    if (!rows[0]) throw new ApiError(404, 'Usuário não encontrado.');

    await logAction(req, {
      action: 'USER_UPDATED', entityType: 'user', entityId: Number(id),
      details: { name, job_title, has_signature, is_active },
    });

    res.json({ data: toPublicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
}

async function updateRole(req, res, next) {
  try {
    const { id } = req.params;
    const { role } = req.body;
    if (!['admin', 'user'].includes(role)) throw new ApiError(400, 'Papel inválido.');
    if (Number(id) === req.user.id && role !== 'admin') {
      throw new ApiError(400, 'Você não pode remover seu próprio acesso de administrador.');
    }

    const [before] = await pool.query(`SELECT role FROM users WHERE id = ?`, [id]);
    if (!before[0]) throw new ApiError(404, 'Usuário não encontrado.');

    await pool.query(`UPDATE users SET role = ? WHERE id = ?`, [role, id]);
    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ?`, [id]);

    await logAction(req, {
      action: 'USER_ROLE_CHANGED', entityType: 'user', entityId: Number(id),
      details: { from: before[0].role, to: role },
    });

    res.json({ data: toPublicUser(rows[0]) });
  } catch (err) {
    next(err);
  }
}

async function deactivate(req, res, next) {
  try {
    const { id } = req.params;
    if (Number(id) === req.user.id) throw new ApiError(400, 'Você não pode desativar sua própria conta.');

    const [rows] = await pool.query(`SELECT id FROM users WHERE id = ?`, [id]);
    if (!rows[0]) throw new ApiError(404, 'Usuário não encontrado.');

    await pool.query(`UPDATE users SET is_active = 0 WHERE id = ?`, [id]);
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL`, [id]);

    await logAction(req, { action: 'USER_DEACTIVATED', entityType: 'user', entityId: Number(id) });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create, update, updateRole, deactivate };