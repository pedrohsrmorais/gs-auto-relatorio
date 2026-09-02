const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');

// Contas de usuário são criadas pelo admin via user.controller.js —
// este controller cuida apenas de sessão (login/refresh/logout) e
// self-service do próprio usuário logado (me/changePassword).

const ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL || '15m';
const REFRESH_TOKEN_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS || 30);

function signAccessToken(user) {
  return jwt.sign(
    { sub: user.id, role: user.role, name: user.name },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: ACCESS_TOKEN_TTL }
  );
}

function hashToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

async function issueRefreshToken(userId) {
  const rawToken = crypto.randomBytes(48).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

  await pool.query(
    'INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)',
    [userId, tokenHash, expiresAt]
  );

  return rawToken;
}

// POST /api/auth/login
exports.login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    throw new ApiError(400, 'Informe email e senha.');
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];

  // Mesma mensagem para "não existe" e "senha errada" — evita enumeração de e-mails.
  if (!user || !user.is_active) {
    throw new ApiError(401, 'Credenciais inválidas.');
  }

  const passwordMatches = await bcrypt.compare(password, user.password_hash);
  if (!passwordMatches) {
    throw new ApiError(401, 'Credenciais inválidas.');
  }

  const accessToken = signAccessToken(user);
  const refreshToken = await issueRefreshToken(user.id);

  await pool.query('UPDATE users SET last_login_at = NOW() WHERE id = ?', [user.id]);

  const { password_hash, ...safeUser } = user;
  sendSuccess(res, { user: safeUser, accessToken, refreshToken });
});

// POST /api/auth/refresh
exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new ApiError(400, 'refreshToken é obrigatório.');

  const tokenHash = hashToken(refreshToken);
  const [rows] = await pool.query(
    `SELECT rt.id, rt.expires_at, rt.revoked_at, u.id AS user_id, u.role, u.name, u.is_active
     FROM refresh_tokens rt
     JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = ?`,
    [tokenHash]
  );
  const stored = rows[0];

  const isValid = stored && !stored.revoked_at && new Date(stored.expires_at) > new Date() && stored.is_active;
  if (!isValid) {
    throw new ApiError(401, 'Refresh token inválido ou expirado.');
  }

  // Rotação: revoga o token usado e emite um par novo.
  await pool.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE id = ?', [stored.id]);
  const newRefreshToken = await issueRefreshToken(stored.user_id);
  const accessToken = signAccessToken({ id: stored.user_id, role: stored.role, name: stored.name });

  sendSuccess(res, { accessToken, refreshToken: newRefreshToken });
});

// POST /api/auth/logout
exports.logout = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (refreshToken) {
    const tokenHash = hashToken(refreshToken);
    await pool.query(
      'UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = ? AND revoked_at IS NULL',
      [tokenHash]
    );
  }
  sendSuccess(res, null, { message: 'Sessão encerrada.' });
});

// GET /api/auth/me  (requer middleware authenticate; usa req.user.id)
exports.me = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT id, name, email, role, job_title, has_signature, is_active, last_login_at
     FROM users WHERE id = ?`,
    [req.user.id]
  );
  if (!rows.length) throw new ApiError(404, 'Usuário não encontrado.');
  sendSuccess(res, rows[0]);
});

// PATCH /api/auth/me/password
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    throw new ApiError(400, 'Informe a senha atual e a nova senha.');
  }
  if (newPassword.length < 8) {
    throw new ApiError(400, 'A nova senha deve ter ao menos 8 caracteres.');
  }

  const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.id]);
  const user = rows[0];
  const matches = await bcrypt.compare(currentPassword, user.password_hash);
  if (!matches) throw new ApiError(401, 'Senha atual incorreta.');

  const newHash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.user.id]);

  // Por segurança, invalida todas as sessões ativas ao trocar a senha.
  await pool.query(
    'UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = ? AND revoked_at IS NULL',
    [req.user.id]
  );

  sendSuccess(res, null, { message: 'Senha alterada com sucesso. Faça login novamente.' });
});
