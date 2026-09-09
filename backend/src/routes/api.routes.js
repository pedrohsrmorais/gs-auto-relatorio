const { Router } = require('express');
const { authenticate } = require('../middlewares/auth.middleware');
const { identify, authorize } = require('../middlewares/user.middleware');

const authController        = require('../controllers/auth.controller');
const usersController       = require('../controllers/users.controller');
const jobController         = require('../controllers/job.controller');
const perdcompController    = require('../controllers/perdcomp.controller');
const darfController        = require('../controllers/darf.controller');
const pontosController      = require('../controllers/pontos.controller');
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
router.get('/clients',  jobController.listClients);
router.post('/clients', jobController.createClient);

// Jobs
router.get('/jobs',                 jobController.list);
router.get('/jobs/:id',             jobController.get);
router.post('/jobs',                jobController.create);
router.patch('/jobs/:id/status',    jobController.updateStatus);
router.patch('/jobs/:id/details',   jobController.updateDetails);

// Equipe do job
router.put('/jobs/:jobId/team',                   jobController.setTeamMember);
router.delete('/jobs/:jobId/team/:memberId',      jobController.removeTeamMember);

// Diagnóstico
router.get('/jobs/:jobId/diagnostic',  jobController.getDiagnostic);
router.put('/jobs/:jobId/diagnostic',  jobController.upsertDiagnostic);

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

// Pontos ADM
router.get('/jobs/:jobId/pontos-adm',                 pontosController.listAdm);
router.post('/jobs/:jobId/pontos-adm/bulk-import',    pontosController.bulkImportAdm);
router.delete('/jobs/:jobId/pontos-adm',              pontosController.clearAdm);

// Pontos FTX
router.get('/jobs/:jobId/pontos-ftx',                 pontosController.listFtx);
router.post('/jobs/:jobId/pontos-ftx/bulk-import',    pontosController.bulkImportFtx);
router.delete('/jobs/:jobId/pontos-ftx',              pontosController.clearFtx);

// Comparativo por categoria (Relatório 2)
router.get('/jobs/:jobId/ftx-categoria',              pontosController.listFtxCategoria);
router.post('/jobs/:jobId/ftx-categoria/bulk-import', pontosController.bulkImportFtxCategoria);
router.delete('/jobs/:jobId/ftx-categoria',           pontosController.clearFtxCategoria);

// Definições de pontos ADM/FTX (nomeação dos pontos importados via planilha)
router.get('/credit-point-definitions',               pontosController.listDefinitions);
router.patch('/credit-point-definitions/:id',         pontosController.updateDefinitionName);

// Logs (admin)
router.get('/logs',                 authorize('admin'), logsController.list);
router.get('/jobs/:jobId/logs',     authorize('admin'), logsController.listByJob);

module.exports = router;