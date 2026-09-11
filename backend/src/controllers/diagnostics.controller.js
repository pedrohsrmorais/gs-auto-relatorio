const { pool } = require('../config/database');

/* =====================================================================
 * diagnostics.controller.js
 *
 * Tela de Diagnóstico do job. Duas dimensões de filtro:
 *
 *  - category: ADM | FTX            (de onde vem a análise)
 *  - tax:      PIS_COFINS | IPI | IRPJ_CSLL   (a qual tributo pertence)
 *              (default: PIS_COFINS, para manter compatibilidade com
 *              chamadas antigas que não mandam ?tax=)
 *
 * Cada combinação aponta pra uma tabela de valores diferente:
 *   ADM/FTX + PIS_COFINS -> pontos_adm / pontos_ftx (mensal, split PIS/COFINS)
 *   ADM     + IPI        -> pontos_ipi              (mensal, valor único)
 *   ADM     + IRPJ_CSLL  -> pontos_ir_csll           (anual, split IRPJ/CSLL)
 *
 * O formato de resposta do resumo por ponto inclui SEMPRE `total`, e um
 * array `breakdown` com os componentes (PIS/COFINS, IRPJ/CSLL, ou vazio
 * para IPI que não tem split). Os campos legados `pis_total`/`cofins_total`
 * continuam sendo enviados quando tax=PIS_COFINS para não quebrar o
 * frontend existente.
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALID_CATEGORIES = ['ADM', 'FTX'];
const VALID_TAXES = ['PIS_COFINS', 'IPI', 'IRPJ_CSLL'];

function toNumber(v) {
  return v === null || v === undefined ? 0 : Number(v);
}

function assertValidCategory(category) {
  if (!VALID_CATEGORIES.includes(category)) {
    throw new ApiError(400, 'Categoria inválida. Use "ADM" ou "FTX".');
  }
}

function resolveTax(taxQuery) {
  const tax = taxQuery || 'PIS_COFINS';
  if (!VALID_TAXES.includes(tax)) {
    throw new ApiError(400, `Tributo inválido. Use um de: ${VALID_TAXES.join(', ')}.`);
  }
  return tax;
}

async function assertJobExists(jobId) {
  const [rows] = await pool.query(`SELECT id FROM jobs WHERE id = ?`, [jobId]);
  if (!rows[0]) throw new ApiError(404, 'Job não encontrado.');
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

// ═════════════════════════════════════════════════════════════════════════
// PIS/COFINS — pontos_adm / pontos_ftx (mensal, split PIS/COFINS)
// ═════════════════════════════════════════════════════════════════════════

function tableForCategory(category) {
  return category === 'ADM' ? 'pontos_adm' : 'pontos_ftx';
}

async function listPointsPisCofins(jobId, category) {
  const table = tableForCategory(category);

  const [rows] = await pool.query(
    `SELECT
       d.id AS credit_point_definition_id,
       d.external_id,
       d.name,
       d.risk_color,
       SUM(CASE WHEN p.contribution = 'PIS' THEN p.value ELSE 0 END) AS pis_total,
       SUM(CASE WHEN p.contribution = 'COFINS' THEN p.value ELSE 0 END) AS cofins_total
     FROM ${table} p
     JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
     WHERE p.job_id = ?
     GROUP BY d.id, d.external_id, d.name, d.risk_color
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId]
  );

  if (rows.length > 0) {
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
      `SELECT credit_point_definition_id, observations
       FROM job_point_notes
       WHERE job_id = ? AND credit_point_definition_id IN (?)`,
      [jobId, ids]
    );
    notesById = new Map(notes.map((n) => [n.credit_point_definition_id, n]));
  }

  return rows.map((r) => {
    const note = notesById.get(r.credit_point_definition_id);
    const pis = toNumber(r.pis_total);
    const cofins = toNumber(r.cofins_total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id: r.external_id,
      name: r.name,
      risk_color: r.risk_color ?? null,
      pis_total: pis,
      cofins_total: cofins,
      total: pis + cofins,
      breakdown: [
        { label: 'PIS', value: pis },
        { label: 'COFINS', value: cofins },
      ],
      observations: note?.observations ?? null,
    };
  });
}

async function getMonthlyPisCofins(jobId, category, creditPointDefinitionId) {
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

  return rows.map((r) => ({
    period_label: r.reference_month,
    pis_value: toNumber(r.pis_value),
    cofins_value: toNumber(r.cofins_value),
    total: toNumber(r.pis_value) + toNumber(r.cofins_value),
  }));
}

// ═════════════════════════════════════════════════════════════════════════
// IPI — pontos_ipi (mensal, valor único, sem split)
// ═════════════════════════════════════════════════════════════════════════

async function listPointsIpi(jobId) {
  const [rows] = await pool.query(
    `SELECT
       d.id AS credit_point_definition_id,
       d.external_id,
       d.name,
       SUM(p.value) AS total
     FROM pontos_ipi p
     JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
     WHERE p.job_id = ?
     GROUP BY d.id, d.external_id, d.name
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId]
  );

  if (rows.length > 0) {
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
      `SELECT credit_point_definition_id, observations FROM job_point_notes
       WHERE job_id = ? AND credit_point_definition_id IN (?)`,
      [jobId, ids]
    );
    notesById = new Map(notes.map((n) => [n.credit_point_definition_id, n]));
  }

  return rows.map((r) => {
    const note = notesById.get(r.credit_point_definition_id);
    const total = toNumber(r.total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id: r.external_id,
      name: r.name,
      risk_color: null,
      total,
      breakdown: [],
      observations: note?.observations ?? null,
    };
  });
}

async function getMonthlyIpi(jobId, creditPointDefinitionId) {
  const [rows] = await pool.query(
    `SELECT reference_month, value
     FROM pontos_ipi
     WHERE job_id = ? AND credit_point_definition_id = ?
     ORDER BY reference_month ASC`,
    [jobId, creditPointDefinitionId]
  );

  return rows.map((r) => ({
    period_label: r.reference_month,
    total: toNumber(r.value),
  }));
}

// ═════════════════════════════════════════════════════════════════════════
// IRPJ/CSLL — pontos_ir_csll (anual, split IRPJ/CSLL)
// ═════════════════════════════════════════════════════════════════════════

async function listPointsIrCsll(jobId) {
  const [rows] = await pool.query(
    `SELECT
       d.id AS credit_point_definition_id,
       d.external_id,
       d.name,
       SUM(CASE WHEN p.tax_sub_type = 'IRPJ' THEN p.value ELSE 0 END) AS irpj_total,
       SUM(CASE WHEN p.tax_sub_type = 'CSLL' THEN p.value ELSE 0 END) AS csll_total
     FROM pontos_ir_csll p
     JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
     WHERE p.job_id = ?
     GROUP BY d.id, d.external_id, d.name
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId]
  );

  if (rows.length > 0) {
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
      `SELECT credit_point_definition_id, observations FROM job_point_notes
       WHERE job_id = ? AND credit_point_definition_id IN (?)`,
      [jobId, ids]
    );
    notesById = new Map(notes.map((n) => [n.credit_point_definition_id, n]));
  }

  return rows.map((r) => {
    const note = notesById.get(r.credit_point_definition_id);
    const irpj = toNumber(r.irpj_total);
    const csll = toNumber(r.csll_total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id: r.external_id,
      name: r.name,
      risk_color: null,
      irpj_total: irpj,
      csll_total: csll,
      total: irpj + csll,
      breakdown: [
        { label: 'IRPJ', value: irpj },
        { label: 'CSLL', value: csll },
      ],
      observations: note?.observations ?? null,
    };
  });
}

async function getMonthlyIrCsll(jobId, creditPointDefinitionId) {
  const [rows] = await pool.query(
    `SELECT
       reference_year,
       SUM(CASE WHEN tax_sub_type = 'IRPJ' THEN value ELSE 0 END) AS irpj_value,
       SUM(CASE WHEN tax_sub_type = 'CSLL' THEN value ELSE 0 END) AS csll_value
     FROM pontos_ir_csll
     WHERE job_id = ? AND credit_point_definition_id = ?
     GROUP BY reference_year
     ORDER BY reference_year ASC`,
    [jobId, creditPointDefinitionId]
  );

  return rows.map((r) => ({
    period_label: String(r.reference_year),
    irpj_value: toNumber(r.irpj_value),
    csll_value: toNumber(r.csll_value),
    total: toNumber(r.irpj_value) + toNumber(r.csll_value),
  }));
}

// ═════════════════════════════════════════════════════════════════════════
// Endpoints — despacham para a implementação certa conforme `tax`
// ═════════════════════════════════════════════════════════════════════════

// GET /jobs/:jobId/diagnostics/points?category=ADM|FTX&tax=PIS_COFINS|IPI|IRPJ_CSLL
async function listPoints(req, res, next) {
  try {
    const { jobId } = req.params;
    const { category } = req.query;
    assertValidCategory(category);
    const tax = resolveTax(req.query.tax);
    await assertJobExists(jobId);

    if (tax === 'IPI') {
      if (category !== 'ADM') throw new ApiError(400, 'IPI só está disponível na categoria ADM.');
      return res.json({ data: await listPointsIpi(jobId) });
    }
    if (tax === 'IRPJ_CSLL') {
      if (category !== 'ADM') throw new ApiError(400, 'IRPJ/CSLL só está disponível na categoria ADM.');
      return res.json({ data: await listPointsIrCsll(jobId) });
    }
    res.json({ data: await listPointsPisCofins(jobId, category) });
  } catch (err) {
    next(err);
  }
}

// GET /jobs/:jobId/diagnostics/points/:creditPointDefinitionId/monthly?category=&tax=
async function getMonthly(req, res, next) {
  try {
    const { jobId, creditPointDefinitionId } = req.params;
    const { category } = req.query;
    assertValidCategory(category);
    const tax = resolveTax(req.query.tax);
    await assertJobExists(jobId);

    if (tax === 'IPI') {
      return res.json({ data: await getMonthlyIpi(jobId, creditPointDefinitionId) });
    }
    if (tax === 'IRPJ_CSLL') {
      return res.json({ data: await getMonthlyIrCsll(jobId, creditPointDefinitionId) });
    }
    res.json({ data: await getMonthlyPisCofins(jobId, category, creditPointDefinitionId) });
  } catch (err) {
    next(err);
  }
}

// PUT /jobs/:jobId/diagnostics/points/:creditPointDefinitionId
// Observação do analista — não depende de tax/category: é sempre a mesma
// tabela job_point_notes, chaveada só por (job_id, credit_point_definition_id).
async function updateNote(req, res, next) {
  try {
    const { jobId, creditPointDefinitionId } = req.params;
    const { observations } = req.body;

    await assertJobExists(jobId);

    const [related] = await pool.query(
      `SELECT 1 FROM pontos_adm WHERE job_id = ? AND credit_point_definition_id = ?
       UNION SELECT 1 FROM pontos_ftx WHERE job_id = ? AND credit_point_definition_id = ?
       UNION SELECT 1 FROM pontos_ipi WHERE job_id = ? AND credit_point_definition_id = ?
       UNION SELECT 1 FROM pontos_ir_csll WHERE job_id = ? AND credit_point_definition_id = ?
       LIMIT 1`,
      [jobId, creditPointDefinitionId, jobId, creditPointDefinitionId, jobId, creditPointDefinitionId, jobId, creditPointDefinitionId]
    );
    if (!related[0]) throw new ApiError(404, 'Ponto não encontrado para este job.');

    await pool.query(
      `INSERT INTO job_point_notes (job_id, credit_point_definition_id, observations)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE observations = VALUES(observations)`,
      [jobId, creditPointDefinitionId, observations ?? null]
    );

    const [rows] = await pool.query(
      `SELECT job_id, credit_point_definition_id, observations, updated_at
       FROM job_point_notes WHERE job_id = ? AND credit_point_definition_id = ?`,
      [jobId, creditPointDefinitionId]
    );

    await logAction(req, {
      action: 'JOB_POINT_NOTE_UPDATED',
      entityType: 'job_point_notes',
      entityId: Number(creditPointDefinitionId),
      jobId: Number(jobId),
      details: { observations },
    });

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { listPoints, getMonthly, updateNote };