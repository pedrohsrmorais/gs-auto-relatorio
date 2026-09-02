const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');

// Middleware de sessão: lê o access token JWT do header
// "Authorization: Bearer <token>", valida com JWT_ACCESS_SECRET (o mesmo
// segredo usado em auth.controller.js/signAccessToken) e popula req.user
// com { id, role, name }. Deve rodar antes de qualquer rota protegida.
module.exports = function session(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [scheme, token] = authHeader.split(' ');

  if (scheme !== 'Bearer' || !token) {
    return next(new ApiError(401, 'Token de acesso não informado.'));
  }

  try {
    const payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    req.user = { id: payload.sub, role: payload.role, name: payload.name };
    return next();
  } catch (err) {
    return next(new ApiError(401, 'Token de acesso inválido ou expirado.'));
  }
};