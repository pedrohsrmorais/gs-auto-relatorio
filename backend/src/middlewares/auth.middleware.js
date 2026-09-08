const jwt = require('jsonwebtoken');

/* =====================================================================
 * auth.middleware.js
 * ---------------------------------------------------------------------
 * Autenticação "crua": confere se existe um Bearer token no header
 * Authorization e se ele foi assinado pela API (JWT_ACCESS_SECRET) e
 * ainda não expirou. NÃO consulta o banco — só valida o token em si e
 * popula req.user com o que está no payload (id, role, name).
 *
 * Isso é rápido e suficiente pra maioria das rotas, mas não garante que
 * o usuário ainda exista/esteja ativo (ex.: foi desativado depois de
 * logar). Para essa garantia, encadeie com o middleware `identify`
 * (user.middleware.js) logo em seguida.
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// Uso: router.use(authenticate)  OU  router.get('/rota', authenticate, handler)
function authenticate(req, res, next) {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Token de acesso não informado.'));
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = { id: decoded.sub, role: decoded.role, name: decoded.name };
    return next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return next(new ApiError(401, 'Token expirado. Faça login novamente.'));
    }
    return next(new ApiError(401, 'Token inválido.'));
  }
}

module.exports = { authenticate };