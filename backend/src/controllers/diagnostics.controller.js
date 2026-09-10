const { pool } = require('../config/database');

/* =====================================================================
 * diagnostics.controller.js
 *
 * Tela de Diagnóstico: lista consolidada de créditos PIS/COFINS por ponto
 * (ADM ou FTX), com observação e cor de risco editáveis pelo analista,
 * e o detalhamento mês a mês por ponto (usado no modal).
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALID_CATEGORIES = ['ADM', 'FTX'];
const VALID_RISK_COLORS = ['VERDE', 'AMARELO', 'VERMELHO'];

function tableForCategory(category) {
  return category === 'ADM' ? 'pontos_adm' : 'pontos_ftx';
}

function toNumber(v) {
  return v === null || v === undefined ? 0 : Number(v);
}

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

function assertValidCategory(category) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new ApiError(400, 'Categoria inválida. Use "ADM" ou "FTX".');
  }
}

// ─── GET /jobs/:jobId/diagnostics/points?category=ADM|FTX ────────────────────
// Lista consolidada: um item por ponto de crédito, com totais de PIS/COFINS
// somados de todos os meses, mais a observação e cor de risco (se já houver).
// Cria automaticamente uma nota vazia para pontos ainda sem observação.

async function listPoints(req, res, next) {
  try {
    const { jobId } = req.params;
    const { category } = req.query;
    assertValidCategory(category);
    await assertJobExists(jobId);

    const table = tableForCategory(category);

    const [rows] = await pool.query(
      `SELECT
         d.id AS credit_point_definition_id,
         d.external_id,
         d.name,
         SUM(CASE WHEN p.contribution = 'PIS' THEN p.value ELSE 0 END) AS pis_total,
         SUM(CASE WHEN p.contribution = 'COFINS' THEN p.value ELSE 0 END) AS cofins_total
       FROM ${table} p
       JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
       WHERE p.job_id = ?
       GROUP BY d.id, d.external_id, d.name
       ORDER BY d.name ASC, d.external_id ASC`,
      [jobId]
    );

    if (rows.length > 0) {
      // Garante que toda ponto encontrado já tenha uma linha de nota (observação/cor),
      // mesmo que vazia — não sobrescreve o que já existir.
      const values = rows.map((r) => [jobId, r.credit_point_definition_id]);
      await pool.query(
        `INSERT IGNORE INTO job_point_notes (job_id, credit_point_definition_id) VALUES ?`,
        [values]
      );
    }

    const ids = rows.map((r) => r.credit_point_definition_id);
    let notesById = new Map();
    if (ids.length > 0) {
      const [notes] = await pool.query(
        `SELECT credit_point_definition_id, risk_color, observations
         FROM job_point_notes
         WHERE job_id = ? AND credit_point_definition_id IN (?)`,
        [jobId, ids]
      );
      notesById = new Map(notes.map((n) => [n.credit_point_definition_id, n]));
    }

    const data = rows.map((r) => {
      const note = notesById.get(r.credit_point_definition_id);
      const pis = toNumber(r.pis_total);
      const cofins = toNumber(r.cofins_total);
      return {
        credit_point_definition_id: r.credit_point_definition_id,
        external_id: r.external_id,
        name: r.name,
        pis_total: pis,
        cofins_total: cofins,
        total: pis + cofins,
        risk_color: note?.risk_color ?? null,
        observations: note?.observations ?? null,
      };
    });

    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// ─── GET /jobs/:jobId/diagnostics/points/:creditPointDefinitionId/monthly ────
// Detalhamento mês a mês de PIS e COFINS para um único ponto (usado no modal).

async function getMonthly(req, res, next) {
  try {
    const { jobId, creditPointDefinitionId } = req.params;
    const { category } = req.query;
    assertValidCategory(category);
    await assertJobExists(jobId);

    const table = tableForCategory(category);

    const [rows] = await pool.query(
      `SELECT
         reference_month,
         SUM(CASE WHEN contribution = 'PIS' THEN value ELSE 0 END) AS pis_value,
         SUM(CASE WHEN contribution = 'COFINS' THEN value ELSE 0 END) AS cofins_value
       FROM ${table}
       WHERE job_id = ? AND credit_point_definition_id = ?
       GROUP BY reference_month
       ORDER BY reference_month ASC`,
      [jobId, creditPointDefinitionId]
    );

    const data = rows.map((r) => ({
      reference_month: r.reference_month,
      pis_value: toNumber(r.pis_value),
      cofins_value: toNumber(r.cofins_value),
    }));

    res.json({ data });
  } catch (err) {
    next(err);
  }
}

// ─── PUT /jobs/:jobId/diagnostics/points/:creditPointDefinitionId ────────────
// Salva/atualiza a observação e a cor de risco do analista para um ponto.

async function updateNote(req, res, next) {
  try {
    const { jobId, creditPointDefinitionId } = req.params;
    const { risk_color, observations } = req.body;

    await assertJobExists(jobId);

    if (risk_color !== undefined && risk_color !== null && !VALID_RISK_COLORS.includes(risk_color)) {
      throw new ApiError(400, 'Cor de risco inválida.');
    }

    // Confirma que o ponto realmente pertence a este job (apareceu em algum import).
    const [related] = await pool.query(
      `SELECT 1 FROM pontos_adm WHERE job_id = ? AND credit_point_definition_id = ?
       UNION
       SELECT 1 FROM pontos_ftx WHERE job_id = ? AND credit_point_definition_id = ?
       LIMIT 1`,
      [jobId, creditPointDefinitionId, jobId, creditPointDefinitionId]
    );
    if (!related[0]) throw new ApiError(404, 'Ponto não encontrado para este job.');

    await pool.query(
      `INSERT INTO job_point_notes (job_id, credit_point_definition_id, risk_color, observations)
       VALUES (?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         risk_color = VALUES(risk_color),
         observations = VALUES(observations)`,
      [jobId, creditPointDefinitionId, risk_color ?? null, observations ?? null]
    );

    const [rows] = await pool.query(
      `SELECT job_id, credit_point_definition_id, risk_color, observations, updated_at
       FROM job_point_notes
       WHERE job_id = ? AND credit_point_definition_id = ?`,
      [jobId, creditPointDefinitionId]
    );

    await logAction(req, {
      action: 'JOB_POINT_NOTE_UPDATED',
      entityType: 'job_point_notes',
      entityId: Number(creditPointDefinitionId),
      jobId: Number(jobId),
      details: { risk_color, observations },
    });

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPoints, getMonthly, updateNote };