const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

/* =====================================================================
 * auth.controller.js
 * ---------------------------------------------------------------------
 * Login, refresh de token, logout e troca de senha.
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_DAYS = 30;

function hashRefreshToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

async function issueRefreshToken(userId) {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashRefreshToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);
  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
    [userId, tokenHash, expiresAt]
  );
  return rawToken;
}

async function logAction(req, { action, entityType = null, entityId = null, jobId = null, details = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, job_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user?.id ?? null,
        action,
        entityType,
        entityId,
        jobId,
        details ? JSON.stringify(details) : null,
        req.ip ?? null,
      ]
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
    is_active: !!row.is_active,
  };
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    if (!email || !password) throw new ApiError(400, 'E-mail e senha são obrigatórios.');

    const [rows] = await pool.query(`SELECT * FROM users WHERE email = ? LIMIT 1`, [email]);
    const user = rows[0];
    if (!user || !user.is_active) throw new ApiError(401, 'Credenciais inválidas.');

    const passwordOk = await bcrypt.compare(password, user.password_hash);
    if (!passwordOk) throw new ApiError(401, 'Credenciais inválidas.');

    const accessToken = signAccessToken(user);
    const refreshToken = await issueRefreshToken(user.id);

    await pool.query(`UPDATE users SET last_login_at = NOW() WHERE id = ?`, [user.id]);

    // req.user ainda não existe neste ponto (rota pública), então montamos manualmente pro log.
    req.user = { id: user.id };
    await logAction(req, { action: 'LOGIN', entityType: 'user', entityId: user.id });

    res.json({ data: { user: toPublicUser(user), accessToken, refreshToken } });
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new ApiError(400, 'refreshToken é obrigatório.');

    const tokenHash = hashRefreshToken(refreshToken);
    const [rows] = await pool.query(
      `SELECT rt.*, u.role, u.name, u.is_active
       FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
       WHERE rt.token_hash = ? AND rt.revoked_at IS NULL AND rt.expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    const record = rows[0];
    if (!record || !record.is_active) throw new ApiError(401, 'Sessão expirada. Faça login novamente.');

    // Rotação: revoga o token usado e emite um novo par.
    await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?`, [record.id]);

    const newAccessToken = signAccessToken({ id: record.user_id, role: record.role, name: record.name });
    const newRefreshToken = await issueRefreshToken(record.user_id);

    res.json({ data: { accessToken: newAccessToken, refreshToken: newRefreshToken } });
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = hashRefreshToken(refreshToken);
      const [rows] = await pool.query(`SELECT user_id FROM refresh_tokens WHERE token_hash = ? LIMIT 1`, [tokenHash]);
      await pool.query(`UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ?`, [tokenHash]);
      if (rows[0]) {
        req.user = { id: rows[0].user_id };
        await logAction(req, { action: 'LOGOUT', entityType: 'user', entityId: rows[0].user_id });
      }
    }
    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ? LIMIT 1`, [req.user.id]);
    const user = rows[0];
    if (!user) throw new ApiError(404, 'Usuário não encontrado.');
    res.json({ data: toPublicUser(user) });
  } catch (err) {
    next(err);
  }
}

async function changePassword(req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword || newPassword.length < 8) {
      throw new ApiError(400, 'Senha atual e nova senha (mín. 8 caracteres) são obrigatórias.');
    }

    const [rows] = await pool.query(`SELECT * FROM users WHERE id = ? LIMIT 1`, [req.user.id]);
    const user = rows[0];
    const passwordOk = await bcrypt.compare(currentPassword, user.password_hash);
    if (!passwordOk) throw new ApiError(401, 'Senha atual incorreta.');

    const newHash = await bcrypt.hash(newPassword, 12);
    await pool.query(`UPDATE users SET password_hash = ? WHERE id = ?`, [newHash, req.user.id]);

    await logAction(req, { action: 'PASSWORD_CHANGED', entityType: 'user', entityId: req.user.id });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { login, refresh, logout, me, changePassword };