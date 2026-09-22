const path = require('path');
const { pool } = require('../config/database');
const diagnosticsController = require('./diagnostics.controller');
const { generateResultadoPptx } = require('../services/pptx.service');

/* =====================================================================
 * resultado.controller.js
 *
 * Módulo "Resultado" — vem depois do Diagnóstico. Aqui o analista marca
 * quais pontos do diagnóstico ficam "OK" (confirmed_in_result, coluna nova
 * em job_point_notes) e, com base só nesses pontos confirmados, gera a
 * apresentação final (.pptx) a partir do template SLIDE_PADRÃO_-_V6.pptx.
 *
 * Reaproveita as funções de listagem já existentes em
 * diagnostics.controller.js (listPointsPisCofins/Ipi/IrCsll/Inss) — cada
 * uma já devolve o campo `confirmed` por ponto, então aqui só filtramos e
 * remontamos no formato que o wizard de PPT espera.
 *
 * ADM tem 4 tributos no template (PIS/COFINS, INSS, IRPJ/CSLL, IPI —
 * slides 5-8). FTX tem só 3 (PIS/COFINS, INSS, IRPJ/CSLL — slides 15-17);
 * não existe slide de FTX/IPI no template, então esse tributo não entra
 * no resumo de FTX.
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const ADM_TAXES = ['PIS_COFINS', 'INSS', 'IRPJ_CSLL', 'IPI'];
const FTX_TAXES = ['PIS_COFINS', 'INSS', 'IRPJ_CSLL'];

const TEMPLATE_PATH = path.join(__dirname, '..', 'templates', 'SLIDE_PADRAO_V6.pptx');

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

async function assertJobExists(jobId) {
  const [rows] = await pool.query(`SELECT id FROM jobs WHERE id = ?`, [jobId]);
  if (!rows[0]) throw new ApiError(404, 'Job não encontrado.');
}

// Despacha para a função de listagem certa em diagnostics.controller.js
// conforme o tributo — mesmo mapeamento usado em listPoints/getMonthly lá.
function listPointsByTax(jobId, category, tax) {
  if (tax === 'IPI') return diagnosticsController.listPointsIpi(jobId, category);
  if (tax === 'IRPJ_CSLL') return diagnosticsController.listPointsIrCsll(jobId, category);
  if (tax === 'INSS') return diagnosticsController.listPointsInss(jobId, category);
  return diagnosticsController.listPointsPisCofins(jobId, category);
}

/**
 * Monta { adm: { PIS_COFINS: [...], ... }, ftx: { PIS_COFINS: [...], ... } }
 * só com os pontos confirmados, no formato que o wizard de PPT consome.
 */
async function getConfirmedSummary(jobId) {
  const adm = {};
  for (const tax of ADM_TAXES) {
    const points = await listPointsByTax(jobId, 'ADM', tax);
    adm[tax] = points
      .filter((p) => p.confirmed)
      .map((p) => ({ name: p.name, total: p.total }));
  }

  const ftx = {};
  for (const tax of FTX_TAXES) {
    const points = await listPointsByTax(jobId, 'FTX', tax);
    ftx[tax] = points
      .filter((p) => p.confirmed)
      .map((p) => ({ name: p.name, total: p.total, risk_color: p.risk_color }));
  }

  return { adm, ftx };
}

// GET /jobs/:jobId/resultado/summary
// Só os pontos confirmados, já agrupados por categoria/tributo — útil pra
// tela de revisão final e para debug, além de ser usado internamente por
// generatePpt.
async function getSummary(req, res, next) {
  try {
    const { jobId } = req.params;
    await assertJobExists(jobId);
    const summary = await getConfirmedSummary(jobId);
    res.json({ data: summary });
  } catch (err) {
    next(err);
  }
}

// PATCH /jobs/:jobId/resultado/points/:creditPointDefinitionId
// body: { confirmed: boolean }
async function toggleConfirm(req, res, next) {
  try {
    const { jobId, creditPointDefinitionId } = req.params;
    const { confirmed } = req.body;

    if (typeof confirmed !== 'boolean') {
      throw new ApiError(400, 'Campo "confirmed" é obrigatório e deve ser true ou false.');
    }

    await assertJobExists(jobId);

    const [related] = await pool.query(
      `SELECT 1 FROM pontos_adm WHERE job_id = ? AND credit_point_definition_id = ?
       UNION SELECT 1 FROM pontos_ftx WHERE job_id = ? AND credit_point_definition_id = ?
       UNION SELECT 1 FROM pontos_ipi WHERE job_id = ? AND credit_point_definition_id = ?
       UNION SELECT 1 FROM pontos_ir_csll WHERE job_id = ? AND credit_point_definition_id = ?
       UNION SELECT 1 FROM pontos_inss WHERE job_id = ? AND credit_point_definition_id = ?
       LIMIT 1`,
      [jobId, creditPointDefinitionId, jobId, creditPointDefinitionId, jobId, creditPointDefinitionId,
       jobId, creditPointDefinitionId, jobId, creditPointDefinitionId]
    );
    if (!related[0]) throw new ApiError(404, 'Ponto não encontrado para este job.');

    try {
      await pool.query(
        `INSERT INTO job_point_notes (job_id, credit_point_definition_id, confirmed_in_result)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE confirmed_in_result = VALUES(confirmed_in_result)`,
        [jobId, creditPointDefinitionId, confirmed ? 1 : 0]
      );
    } catch (dbErr) {
      if (dbErr.code === 'ER_BAD_FIELD_ERROR') {
        throw new ApiError(
          500,
          'A coluna confirmed_in_result não existe em job_point_notes. ' +
          'Execute a migração 2026xxxxxx_add_confirmed_in_result.sql.'
        );
      }
      throw dbErr;
    }

    await logAction(req, {
      action: 'RESULTADO_POINT_CONFIRM_TOGGLED',
      entityType: 'job_point_notes',
      entityId: Number(creditPointDefinitionId),
      jobId: Number(jobId),
      details: { confirmed },
    });

    res.json({ data: { credit_point_definition_id: Number(creditPointDefinitionId), confirmed } });
  } catch (err) {
    next(err);
  }
}

// POST /jobs/:jobId/resultado/gerar-ppt
// Gera o .pptx final com os pontos confirmados e devolve o arquivo binário.
async function generatePpt(req, res, next) {
  try {
    const { jobId } = req.params;

    const [jobRows] = await pool.query(
      `SELECT j.job_number FROM jobs j WHERE j.id = ?`,
      [jobId]
    );
    if (!jobRows[0]) throw new ApiError(404, 'Job não encontrado.');

    // Verifica se a coluna confirmed_in_result já existe no banco (migração).
    // Se não existir, informa claramente em vez de retornar 400 genérico.
    try {
      await pool.query(
        `SELECT confirmed_in_result FROM job_point_notes LIMIT 1`
      );
    } catch (colErr) {
      throw new ApiError(
        500,
        'A coluna confirmed_in_result não existe em job_point_notes. ' +
        'Execute a migração 2026xxxxxx_add_confirmed_in_result.sql antes de usar o módulo Resultado.'
      );
    }

    const summary = await getConfirmedSummary(jobId);

    const totalConfirmados =
      Object.values(summary.adm).reduce((acc, arr) => acc + arr.length, 0) +
      Object.values(summary.ftx).reduce((acc, arr) => acc + arr.length, 0);
    if (totalConfirmados === 0) {
      throw new ApiError(400, 'Nenhum ponto confirmado ainda. Confirme ao menos um ponto no Resultado antes de gerar a apresentação.');
    }

    const buffer = await generateResultadoPptx(summary, TEMPLATE_PATH);

    await logAction(req, {
      action: 'RESULTADO_PPT_GENERATED',
      entityType: 'job',
      entityId: Number(jobId),
      jobId: Number(jobId),
      details: { total_pontos_confirmados: totalConfirmados },
    });

    const safeName = String(jobRows[0].job_number || `job-${jobId}`).replace(/[^a-zA-Z0-9_-]+/g, '_');
    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    );
    res.setHeader('Content-Disposition', `attachment; filename="Resultado_${safeName}.pptx"`);
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

module.exports = { getSummary, toggleConfirm, generatePpt };