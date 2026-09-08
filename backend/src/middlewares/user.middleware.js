const { pool } = require('../config/database');

/* =====================================================================
 * user.middleware.js
 * ---------------------------------------------------------------------
 * Roda DEPOIS de `authenticate` (auth.middleware.js). Vai ao banco
 * confirmar que o usuário do token ainda existe e está ativo — cobre o
 * caso de um admin desativar/alterar o papel de alguém que já está com
 * um token válido em mãos — e substitui req.user (que até aqui só tinha
 * o que veio do token) pelos dados atuais do usuário.
 *
 * Também expõe `authorize(...roles)`, usado para travar rotas por papel
 * (ex: gestão de contas e catálogo mestre, que são admin-only).
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Uso: router.use(authenticate, identify)
async function identify(req, res, next) {
  try {
    if (!req.user?.id) return next(new ApiError(401, 'Usuário não autenticado.'));

    const [rows] = await pool.query(
      `SELECT id, name, email, role, job_title, has_signature, is_active
       FROM users WHERE id = ?`,
      [req.user.id]
    );
    const user = rows[0];

    if (!user || !user.is_active) {
      return next(new ApiError(401, 'Usuário não encontrado ou inativo.'));
    }

    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

// Middleware-fábrica: restringe a rota a determinados papéis.
// Uso: router.get('/users', authorize('admin'), userController.list)
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return next(new ApiError(401, 'Usuário não autenticado.'));
    if (!allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'Você não tem permissão para acessar este recurso.'));
    }
    return next();
  };
}

module.exports = { identify, authorize };