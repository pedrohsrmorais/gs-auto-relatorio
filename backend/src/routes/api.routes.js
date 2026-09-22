const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { identify, authorize } = require('../middlewares/user.middleware');

const authController        = require('../controllers/auth.controller');
const usersController       = require('../controllers/users.controller');
const clientsController     = require('../controllers/clients.controller');
const jobController         = require('../controllers/job.controller');
const perdcompController    = require('../controllers/perdcomp.controller');
const darfController        = require('../controllers/darf.controller');
const pontosController      = require('../controllers/pontos.controller');
const diagnosticsController = require('../controllers/diagnostics.controller');
const resultadoController   = require('../controllers/resultado.controller');
const logsController        = require('../controllers/logs.controller');

const router = Router();

// ─── Rotas públicas (sem autenticação) ───────────────────────────────────────

router.post('/auth/login',   authController.login);
router.post('/auth/refresh', authController.refresh);
router.post('/auth/logout',  authController.logout);

// ─── Todas as rotas abaixo exigem token válido ────────────────────────────────

router.use(authenticate, identify);

// Auth
router.get('/auth/me',              authController.me);
router.patch('/auth/me/password',   authController.changePassword);

// Usuários (admin)
router.get('/users',                authorize('admin'), usersController.list);
router.post('/users',               authorize('admin'), usersController.create);
router.put('/users/:id',            authorize('admin'), usersController.update);
router.patch('/users/:id/role',     authorize('admin'), usersController.updateRole);
router.delete('/users/:id',         authorize('admin'), usersController.deactivate);

// Clientes
router.get('/clients',              clientsController.list);
router.post('/clients',             clientsController.create);
router.delete('/clients/:id',       authorize('admin'), clientsController.remove);

// Jobs
router.get('/jobs',                 jobController.list);
router.get('/jobs/:id',             jobController.get);
router.post('/jobs',                jobController.create);
router.patch('/jobs/:id/status',    jobController.updateStatus);
router.patch('/jobs/:id/details',   jobController.updateDetails);
router.delete('/jobs/:id',          authorize('admin'), jobController.remove);

// Equipe do job
router.put('/jobs/:jobId/team',              jobController.setTeamMember);
router.delete('/jobs/:jobId/team/:memberId', jobController.removeTeamMember);

// Diagnóstico por ponto (ADM/FTX x PIS_COFINS/IPI/IRPJ_CSLL/INSS)
router.get('/jobs/:jobId/diagnostics/points',
  diagnosticsController.listPoints);
router.get('/jobs/:jobId/diagnostics/points/:creditPointDefinitionId/monthly',
  diagnosticsController.getMonthly);
router.put('/jobs/:jobId/diagnostics/points/:creditPointDefinitionId',
  diagnosticsController.updateNote);

// Resultado (confirmação de pontos + geração da apresentação final)
router.get('/jobs/:jobId/resultado/summary',
  resultadoController.getSummary);
router.patch('/jobs/:jobId/resultado/points/:creditPointDefinitionId',
  resultadoController.toggleConfirm);
router.post(`/jobs/:jobId/resultado/gerar-ppt`,
  (req, _res, next) => { req.body = req.body || {}; next(); },
  resultadoController.generatePpt);

// PER/DCOMP
router.get('/jobs/:jobId/perdcomps',                  perdcompController.list);
router.post('/jobs/:jobId/perdcomps/bulk-import',     perdcompController.bulkImport);
router.delete('/jobs/:jobId/perdcomps/:id',           perdcompController.remove);
router.delete('/jobs/:jobId/perdcomps',               perdcompController.clearAll);

// DARF
router.get('/jobs/:jobId/darf-entries',               darfController.listDarf);
router.post('/jobs/:jobId/darf-entries/bulk-import',  darfController.bulkImportDarf);
router.delete('/jobs/:jobId/darf-entries/:id',        darfController.removeDarf);
router.delete('/jobs/:jobId/darf-entries',            darfController.clearDarf);

// SPED M400
router.get('/jobs/:jobId/sped/m400',                  darfController.listM400);
router.post('/jobs/:jobId/sped/m400/bulk-import',     darfController.bulkImportM400);
router.delete('/jobs/:jobId/sped/m400/:id',           darfController.removeM400);
router.delete('/jobs/:jobId/sped/m400',               darfController.clearM400);

// SPED M610
router.get('/jobs/:jobId/sped/m610',                  darfController.listM610);
router.post('/jobs/:jobId/sped/m610/bulk-import',     darfController.bulkImportM610);
router.delete('/jobs/:jobId/sped/m610/:id',           darfController.removeM610);
router.delete('/jobs/:jobId/sped/m610',               darfController.clearM610);

// Pontos ADM — PIS/COFINS
router.get('/jobs/:jobId/pontos-adm',                 pontosController.listAdm);
router.post('/jobs/:jobId/pontos-adm/bulk-import',    pontosController.bulkImportAdm);
router.delete('/jobs/:jobId/pontos-adm',              pontosController.clearAdm);

// Pontos FTX — PIS/COFINS
router.get('/jobs/:jobId/pontos-ftx',                 pontosController.listFtx);
router.post('/jobs/:jobId/pontos-ftx/bulk-import',    pontosController.bulkImportFtx);
router.delete('/jobs/:jobId/pontos-ftx',              pontosController.clearFtx);

// Pontos IPI
router.get('/jobs/:jobId/pontos-ipi',                 pontosController.listIpi);
router.post('/jobs/:jobId/pontos-ipi/bulk-import',    pontosController.bulkImportIpi);
router.delete('/jobs/:jobId/pontos-ipi',              pontosController.clearIpi);

// Pontos IR/CSLL
router.get('/jobs/:jobId/pontos-ir-csll',              pontosController.listIrCsll);
router.post('/jobs/:jobId/pontos-ir-csll/bulk-import', pontosController.bulkImportIrCsll);
router.delete('/jobs/:jobId/pontos-ir-csll',           pontosController.clearIrCsll);

// Pontos INSS
router.get('/jobs/:jobId/pontos-inss',                 pontosController.listInss);
router.post('/jobs/:jobId/pontos-inss/bulk-import',    pontosController.bulkImportInss);
router.delete('/jobs/:jobId/pontos-inss',              pontosController.clearInss);

// Definições de pontos (catálogo global)
router.get('/credit-point-definitions',                pontosController.listDefinitions);
router.patch('/credit-point-definitions/:id',          pontosController.updateDefinitionName);
router.post('/credit-point-definitions/bulk-import',   pontosController.bulkImportDefinitions);
router.post('/credit-point-definitions/quick-create',  pontosController.quickCreateDefinition);
router.delete('/credit-point-definitions',             authorize('admin'), pontosController.resetAllDefinitions);
router.delete('/credit-point-definitions/:id',         authorize('admin'), pontosController.removeDefinition);

// Logs (admin)
router.get('/logs',              authorize('admin'), logsController.list);
router.get('/jobs/:jobId/logs',  authorize('admin'), logsController.listByJob);

module.exports = router;