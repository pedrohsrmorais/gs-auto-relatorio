const { pool } = require('../config/database');

/* =====================================================================
 * diagnostics.controller.js
 *
 * Tela de Diagnóstico do job. Duas dimensões de filtro:
 *
 *  - category: ADM | FTX            (de onde vem a análise)
 *  - tax:      PIS_COFINS | IPI | IRPJ_CSLL | INSS  (a qual tributo pertence)
 *              (default: PIS_COFINS, para manter compatibilidade com
 *              chamadas antigas que não mandam ?tax=)
 *
 * Cada combinação aponta pra uma tabela de valores diferente:
 *   ADM/FTX + PIS_COFINS -> pontos_adm / pontos_ftx (mensal, split PIS/COFINS)
 *   ADM/FTX + IPI        -> pontos_ipi              (mensal, valor único)
 *   ADM/FTX + IRPJ_CSLL  -> pontos_ir_csll          (anual, split IRPJ/CSLL)
 *   ADM/FTX + INSS       -> pontos_inss             (anual, valor único)
 *
 * Todas as respostas de ponto incluem agora o campo `confirmed` (boolean),
 * que reflete job_point_notes.confirmed_in_result — usado pelo módulo
 * Resultado para saber quais pontos entram na apresentação final.
 *
 * Este arquivo exporta também as funções internas de listagem
 * (listPointsPisCofins, listPointsIpi, listPointsIrCsll, listPointsInss)
 * para que resultado.controller.js as reutilize sem duplicar queries.
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALID_CATEGORIES = ['ADM', 'FTX'];
const VALID_TAXES = ['PIS_COFINS', 'IPI', 'IRPJ_CSLL', 'INSS'];

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

// ─── Helpers compartilhados pelas 4 funções de listagem ──────────────────────

async function ensureNoteRowsExist(jobId, ids) {
  if (!ids.length) return;
  const values = ids.map((id) => [jobId, id]);
  await pool.query(
    `INSERT IGNORE INTO job_point_notes (job_id, credit_point_definition_id) VALUES ?`,
    [values]
  );
}

async function loadNotesById(jobId, ids) {
  if (!ids.length) return new Map();
  const [notes] = await pool.query(
    `SELECT credit_point_definition_id, observations, confirmed_in_result
     FROM job_point_notes
     WHERE job_id = ? AND credit_point_definition_id IN (?)`,
    [jobId, ids]
  );
  return new Map(notes.map((n) => [n.credit_point_definition_id, n]));
}

// ═══════════════════════════════════════════════════════════════════════
// PIS/COFINS
// ═══════════════════════════════════════════════════════════════════════

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

  const ids = rows.map((r) => r.credit_point_definition_id);
  await ensureNoteRowsExist(jobId, ids);
  const notesById = await loadNotesById(jobId, ids);

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
      confirmed: !!note?.confirmed_in_result,
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

// ═══════════════════════════════════════════════════════════════════════
// IPI
// ═══════════════════════════════════════════════════════════════════════

async function listPointsIpi(jobId, category) {
  const [rows] = await pool.query(
    `SELECT
       d.id AS credit_point_definition_id,
       d.external_id,
       d.name,
       d.risk_color,
       SUM(p.value) AS total
     FROM pontos_ipi p
     JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
     WHERE p.job_id = ? AND d.category = ?
     GROUP BY d.id, d.external_id, d.name, d.risk_color
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId, category]
  );

  const ids = rows.map((r) => r.credit_point_definition_id);
  await ensureNoteRowsExist(jobId, ids);
  const notesById = await loadNotesById(jobId, ids);

  return rows.map((r) => {
    const note = notesById.get(r.credit_point_definition_id);
    const total = toNumber(r.total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id: r.external_id,
      name: r.name,
      risk_color: r.risk_color ?? null,
      total,
      breakdown: [],
      observations: note?.observations ?? null,
      confirmed: !!note?.confirmed_in_result,
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

// ═══════════════════════════════════════════════════════════════════════
// IRPJ/CSLL
// ═══════════════════════════════════════════════════════════════════════

async function listPointsIrCsll(jobId, category) {
  const [rows] = await pool.query(
    `SELECT
       d.id AS credit_point_definition_id,
       d.external_id,
       d.name,
       d.risk_color,
       SUM(CASE WHEN p.tax_sub_type = 'IRPJ' THEN p.value ELSE 0 END) AS irpj_total,
       SUM(CASE WHEN p.tax_sub_type = 'CSLL' THEN p.value ELSE 0 END) AS csll_total
     FROM pontos_ir_csll p
     JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
     WHERE p.job_id = ? AND d.category = ?
     GROUP BY d.id, d.external_id, d.name, d.risk_color
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId, category]
  );

  const ids = rows.map((r) => r.credit_point_definition_id);
  await ensureNoteRowsExist(jobId, ids);
  const notesById = await loadNotesById(jobId, ids);

  return rows.map((r) => {
    const note = notesById.get(r.credit_point_definition_id);
    const irpj = toNumber(r.irpj_total);
    const csll = toNumber(r.csll_total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id: r.external_id,
      name: r.name,
      risk_color: r.risk_color ?? null,
      irpj_total: irpj,
      csll_total: csll,
      total: irpj + csll,
      breakdown: [
        { label: 'IRPJ', value: irpj },
        { label: 'CSLL', value: csll },
      ],
      observations: note?.observations ?? null,
      confirmed: !!note?.confirmed_in_result,
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

// ═══════════════════════════════════════════════════════════════════════
// INSS
// ═══════════════════════════════════════════════════════════════════════

async function listPointsInss(jobId, category) {
  const [rows] = await pool.query(
    `SELECT
       d.id AS credit_point_definition_id,
       d.external_id,
       d.name,
       d.risk_color,
       SUM(p.value) AS total
     FROM pontos_inss p
     JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
     WHERE p.job_id = ? AND d.category = ?
     GROUP BY d.id, d.external_id, d.name, d.risk_color
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId, category]
  );

  const ids = rows.map((r) => r.credit_point_definition_id);
  await ensureNoteRowsExist(jobId, ids);
  const notesById = await loadNotesById(jobId, ids);

  return rows.map((r) => {
    const note = notesById.get(r.credit_point_definition_id);
    const total = toNumber(r.total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id: r.external_id,
      name: r.name,
      risk_color: r.risk_color ?? null,
      total,
      breakdown: [],
      observations: note?.observations ?? null,
      confirmed: !!note?.confirmed_in_result,
    };
  });
}

async function getMonthlyInss(jobId, creditPointDefinitionId) {
  const [rows] = await pool.query(
    `SELECT reference_year, value
     FROM pontos_inss
     WHERE job_id = ? AND credit_point_definition_id = ?
     ORDER BY reference_year ASC`,
    [jobId, creditPointDefinitionId]
  );

  return rows.map((r) => ({
    period_label: String(r.reference_year),
    total: toNumber(r.value),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// Endpoints de rota
// ═══════════════════════════════════════════════════════════════════════

async function listPoints(req, res, next) {
  try {
    const { jobId } = req.params;
    const { category } = req.query;
    assertValidCategory(category);
    const tax = resolveTax(req.query.tax);
    await assertJobExists(jobId);

    if (tax === 'IPI')       return res.json({ data: await listPointsIpi(jobId, category) });
    if (tax === 'IRPJ_CSLL') return res.json({ data: await listPointsIrCsll(jobId, category) });
    if (tax === 'INSS')      return res.json({ data: await listPointsInss(jobId, category) });
    res.json({ data: await listPointsPisCofins(jobId, category) });
  } catch (err) {
    next(err);
  }
}

async function getMonthly(req, res, next) {
  try {
    const { jobId, creditPointDefinitionId } = req.params;
    const { category } = req.query;
    assertValidCategory(category);
    const tax = resolveTax(req.query.tax);
    await assertJobExists(jobId);

    if (tax === 'IPI')       return res.json({ data: await getMonthlyIpi(jobId, creditPointDefinitionId) });
    if (tax === 'IRPJ_CSLL') return res.json({ data: await getMonthlyIrCsll(jobId, creditPointDefinitionId) });
    if (tax === 'INSS')      return res.json({ data: await getMonthlyInss(jobId, creditPointDefinitionId) });
    res.json({ data: await getMonthlyPisCofins(jobId, category, creditPointDefinitionId) });
  } catch (err) {
    next(err);
  }
}

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
       UNION SELECT 1 FROM pontos_inss WHERE job_id = ? AND credit_point_definition_id = ?
       LIMIT 1`,
      [jobId, creditPointDefinitionId, jobId, creditPointDefinitionId, jobId, creditPointDefinitionId,
       jobId, creditPointDefinitionId, jobId, creditPointDefinitionId]
    );
    if (!related[0]) throw new ApiError(404, 'Ponto não encontrado para este job.');

    await pool.query(
      `INSERT INTO job_point_notes (job_id, credit_point_definition_id, observations)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE observations = VALUES(observations)`,
      [jobId, creditPointDefinitionId, observations ?? null]
    );

    const [rows] = await pool.query(
      `SELECT job_id, credit_point_definition_id, observations, confirmed_in_result, updated_at
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

module.exports = {
  // handlers de rota
  listPoints,
  getMonthly,
  updateNote,
  // exportados para resultado.controller.js reutilizar
  listPointsPisCofins,
  listPointsIpi,
  listPointsIrCsll,
  listPointsInss,
};