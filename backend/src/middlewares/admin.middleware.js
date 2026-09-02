const ApiError = require('../utils/ApiError');

// Middleware de autorização: exige que req.user (populado pelo
// session.middleware, que deve rodar antes) tenha role "admin".
// Usar apenas nas rotas que o próprio controller já marca como admin
// (ex.: user.controller.js, tax.controller.js:update).
module.exports = function admin(req, res, next) {
  if (!req.user) {
    return next(new ApiError(401, 'Usuário não autenticado.'));
  }
  if (req.user.role !== 'admin') {
    return next(new ApiError(403, 'Acesso restrito a administradores.'));
  }
  return next();
};