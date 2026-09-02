const express = require('express');
const router = express.Router();

const session = require('../middleware/session.middleware');
const admin = require('../middleware/admin.middleware');

const authController = require('../controllers/auth.controller');
const userController = require('../controllers/user.controller');
const clientController = require('../controllers/client.controller');
const taxController = require('../controllers/tax.controller');
const creditPointController = require('../controllers/creditPoint.controller');
const jobController = require('../controllers/job.controller');
const jobDiagnosticController = require('../controllers/jobDiagnostic.controller');
const jobInssNotesController = require('../controllers/jobInssNotes.controller');
const jobCreditAnalysisController = require('../controllers/jobCreditAnalysis.controller');
const jobCreditUsageController = require('../controllers/jobCreditUsage.controller');
const jobMonthlyRevenueController = require('../controllers/jobMonthlyRevenue.controller');
const jobDarfController = require('../controllers/jobDarf.controller');
const jobSpedM400Controller = require('../controllers/jobSpedM400.controller');
const jobSpedM610Controller = require('../controllers/jobSpedM610.controller');
const jobPerdcompController = require('../controllers/jobPerdcomp.controller');
const jobReportController = require('../controllers/jobReport.controller');

// Este router é pensado para ser montado em app.js com:
//   app.use('/api', require('./routes/api.routes'));

// --- Autenticação (públicas — ainda não há sessão) -------------------------
router.post('/auth/login', authController.login);
router.post('/auth/refresh', authController.refresh);
router.post('/auth/logout', authController.logout);

// A partir daqui, todas as rotas exigem um JWT de acesso válido.
router.use(session);

router.get('/auth/me', authController.me);
router.patch('/auth/me/password', authController.changePassword);

// --- Usuários (admin, exceto getById) ---------------------------------------
router.get('/users', admin, userController.list);
router.get('/users/:id', userController.getById);
router.post('/users', admin, userController.create);
router.put('/users/:id', admin, userController.update);
router.patch('/users/:id/role', admin, userController.updateRole);
router.delete('/users/:id', admin, userController.remove);

// --- Clientes ----------------------------------------------------------------
router.get('/clients', clientController.list);
router.get('/clients/:id', clientController.getById);
router.get('/clients/:id/jobs', clientController.listJobs);
router.post('/clients', clientController.create);
router.put('/clients/:id', clientController.update);
router.delete('/clients/:id', clientController.remove);

// --- Tributos (leitura livre; update é admin) --------------------------------
router.get('/taxes', taxController.list);
router.get('/taxes/:id', taxController.getById);
router.put('/taxes/:id', admin, taxController.update);

// --- Catálogo de pontos de crédito --------------------------------------------
router.get('/credit-points', creditPointController.list);
router.get('/credit-points/:id', creditPointController.getById);
router.post('/credit-points', creditPointController.create);
router.put('/credit-points/:id', creditPointController.update);
router.delete('/credit-points/:id', creditPointController.remove);

// --- Jobs ----------------------------------------------------------------------
router.get('/jobs', jobController.list);
router.get('/jobs/:id', jobController.getById);
router.post('/jobs', jobController.create);
router.put('/jobs/:id', jobController.update);
router.patch('/jobs/:id/status', jobController.updateStatus);
router.delete('/jobs/:id', jobController.remove);

// Equipe do Job
router.get('/jobs/:id/team', jobController.listTeam);
router.post('/jobs/:id/team', jobController.addTeamMember);
router.delete('/jobs/:id/team/:memberId', jobController.removeTeamMember);

// Diagnóstico do Job (1:1)
router.get('/jobs/:jobId/diagnostic', jobDiagnosticController.get);
router.put('/jobs/:jobId/diagnostic', jobDiagnosticController.upsert);

// Observações técnicas de INSS do Job (1:1)
router.get('/jobs/:jobId/inss-notes', jobInssNotesController.get);
router.put('/jobs/:jobId/inss-notes', jobInssNotesController.upsert);

// Análises de pontos de crédito do Job
router.get('/jobs/:jobId/credit-analyses', jobCreditAnalysisController.list);
router.get('/jobs/:jobId/credit-analyses/:analysisId', jobCreditAnalysisController.getById);
router.put('/jobs/:jobId/credit-analyses/:creditPointId', jobCreditAnalysisController.upsertByCreditPoint);
router.delete('/jobs/:jobId/credit-analyses/:analysisId', jobCreditAnalysisController.remove);
router.put('/jobs/:jobId/credit-analyses/:analysisId/months/:month', jobCreditAnalysisController.setMonthlyValue);
router.post('/jobs/:jobId/credit-analyses/:analysisId/months/bulk', jobCreditAnalysisController.bulkSetMonthlyValues);
router.delete('/jobs/:jobId/credit-analyses/:analysisId/months/:valueId', jobCreditAnalysisController.removeMonthlyValue);

// Utilização de créditos do Job
router.get('/jobs/:jobId/credit-usages', jobCreditUsageController.list);
router.post('/jobs/:jobId/credit-usages/bulk', jobCreditUsageController.bulkUpsert);
router.put('/jobs/:jobId/credit-usages/:month', jobCreditUsageController.upsert);
router.delete('/jobs/:jobId/credit-usages/:month', jobCreditUsageController.remove);

// Receitas mensais do Job
router.get('/jobs/:jobId/monthly-revenues', jobMonthlyRevenueController.list);
router.post('/jobs/:jobId/monthly-revenues/bulk', jobMonthlyRevenueController.bulkUpsert);
router.put('/jobs/:jobId/monthly-revenues/:month', jobMonthlyRevenueController.upsert);
router.delete('/jobs/:jobId/monthly-revenues/:month', jobMonthlyRevenueController.remove);

// Lançamentos de DARF do Job
router.get('/jobs/:jobId/darf-entries', jobDarfController.list);
router.get('/jobs/:jobId/darf-entries/:id', jobDarfController.getById);
router.post('/jobs/:jobId/darf-entries', jobDarfController.create);
router.post('/jobs/:jobId/darf-entries/bulk', jobDarfController.bulkImport);
router.put('/jobs/:jobId/darf-entries/:id', jobDarfController.update);
router.delete('/jobs/:jobId/darf-entries/:id', jobDarfController.remove);
router.delete('/jobs/:jobId/darf-entries', jobDarfController.removeAllForJob);

// SPED Contribuições — M400
router.get('/jobs/:jobId/sped-m400', jobSpedM400Controller.list);
router.post('/jobs/:jobId/sped-m400/bulk', jobSpedM400Controller.bulkImport);
router.delete('/jobs/:jobId/sped-m400/:id', jobSpedM400Controller.remove);
router.delete('/jobs/:jobId/sped-m400', jobSpedM400Controller.removeAllForJob);

// SPED Contribuições — M610
router.get('/jobs/:jobId/sped-m610', jobSpedM610Controller.list);
router.post('/jobs/:jobId/sped-m610/bulk', jobSpedM610Controller.bulkImport);
router.delete('/jobs/:jobId/sped-m610/:id', jobSpedM610Controller.remove);
router.delete('/jobs/:jobId/sped-m610', jobSpedM610Controller.removeAllForJob);

// PER/DCOMP
router.get('/jobs/:jobId/perdcomps', jobPerdcompController.list);
router.get('/jobs/:jobId/perdcomps/:id', jobPerdcompController.getById);
router.post('/jobs/:jobId/perdcomps', jobPerdcompController.create);
router.put('/jobs/:jobId/perdcomps/:id', jobPerdcompController.update);
router.delete('/jobs/:jobId/perdcomps/:id', jobPerdcompController.remove);

// Pareceres (relatórios) do Job
router.get('/jobs/:jobId/reports', jobReportController.list);
router.get('/jobs/:jobId/reports/:id', jobReportController.getById);
router.post('/jobs/:jobId/reports', jobReportController.create);
router.put('/jobs/:jobId/reports/:id', jobReportController.update);
router.patch('/jobs/:jobId/reports/:id/status', jobReportController.updateStatus);
router.delete('/jobs/:jobId/reports/:id', jobReportController.remove);

module.exports = router;