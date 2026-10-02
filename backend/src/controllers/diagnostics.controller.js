const { pool } = require('../config/database');
const logService      = require('../services/logs.service');
const PDFDocument = require('pdfkit');   // npm install pdfkit
const AdmZip      = require('adm-zip'); // npm install adm-zip
const fs          = require('fs');
const path        = require('path');

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
 * Pontos fixos (always_show = 1):
 *   Pontos marcados como "principal" no catálogo aparecem SEMPRE no
 *   diagnóstico, mesmo que o job não tenha nenhum dado importado para eles.
 *   O analista deve preencher a observation explicando o valor 0.
 *   Implementação: credit_point_definitions é a tabela primária (LEFT JOIN
 *   nas tabelas de pontos). O filtro é:
 *     WHERE (d.always_show = 1 OR p.job_id IS NOT NULL)
 *
 * Fluxo de validação:
 *   1. Analista escreve observations → review_status fica PENDING
 *   2. Admin lê, pode aprovar (APPROVED) ou devolver com nota (NEEDS_REVIEW)
 *   3. Job só pode avançar para geração de PPT quando todos os pontos
 *      com observations estiverem com review_status = 'APPROVED'
 *
 * Permissões:
 *   - Qualquer autenticado: leitura de pontos e detalhes mensais
 *   - Analista: PUT .../diagnostics/points/:id (só observations)
 *   - Admin:    PUT .../diagnostics/points/:id (observations + review_note + review_status)
 *               PATCH .../diagnostics/points/:id/review (aprovar/devolver sem alterar observations)
 *
 * review_status lifecycle:
 *   PENDING → (admin aprova) → APPROVED
 *   PENDING → (admin devolve) → NEEDS_REVIEW
 *   NEEDS_REVIEW → (analista corrige observations) → PENDING
 *   APPROVED → (analista edita observations) → PENDING  (volta para revisão)
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALID_CATEGORIES = ['ADM', 'FTX'];
const VALID_TAXES = ['PIS_COFINS', 'IPI', 'IRPJ_CSLL', 'INSS'];
const VALID_REVIEW_STATUSES = ['PENDING', 'NEEDS_REVIEW', 'APPROVED'];

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

// ─── Helpers compartilhados ───────────────────────────────────────────────────

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
    `SELECT
       credit_point_definition_id,
       observations,
       confirmed_in_result,
       review_status,
       review_note,
       reviewed_by,
       reviewed_at
     FROM job_point_notes
     WHERE job_id = ? AND credit_point_definition_id IN (?)`,
    [jobId, ids]
  );
  return new Map(notes.map((n) => [n.credit_point_definition_id, n]));
}

// ─── Verifica se todos os pontos do job estão aprovados ───────────────────────
// Exportado para resultado.controller.js usar como guard antes de gerar PPT.
//
// Regra: um ponto "precisa de revisão" se tiver observations preenchida.
// Se tiver observations e review_status != 'APPROVED' → job não pode avançar.
// Pontos sem observations são ignorados (analista ainda não analisou, mas isso
// é responsabilidade do progresso de Coleta, não do Diagnóstico).
async function checkAllPointsApproved(jobId) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS pending_count
     FROM job_point_notes
     WHERE job_id = ?
       AND observations IS NOT NULL
       AND observations != ''
       AND review_status != 'APPROVED'`,
    [jobId]
  );
  return rows[0].pending_count === 0;
}

// Retorna um resumo de quantos pontos estão em cada estado para o job.
// Usado pelo frontend para calcular o % de progresso de Diagnóstico.
async function getDiagnosticProgress(jobId) {
  const [rows] = await pool.query(
    `SELECT
       review_status,
       COUNT(*) AS count
     FROM job_point_notes
     WHERE job_id = ?
       AND observations IS NOT NULL
       AND observations != ''
     GROUP BY review_status`,
    [jobId]
  );

  const result = { PENDING: 0, NEEDS_REVIEW: 0, APPROVED: 0, total: 0 };
  for (const row of rows) {
    result[row.review_status] = Number(row.count);
    result.total += Number(row.count);
  }
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// PIS/COFINS
// ═══════════════════════════════════════════════════════════════════════

function tableForCategory(category) {
  return category === 'ADM' ? 'pontos_adm' : 'pontos_ftx';
}

// credit_point_definitions é a tabela primária → LEFT JOIN na tabela de pontos.
// Garante que pontos fixos (always_show = 1) apareçam mesmo sem dados importados.
// ATENÇÃO: o filtro d.category = ? é obrigatório aqui porque pontos_adm e
// pontos_ftx compartilham credit_point_definitions (separados pelo campo category).
async function listPointsPisCofins(jobId, category) {
  const table = tableForCategory(category);

  const [rows] = await pool.query(
    `SELECT
       d.id          AS credit_point_definition_id,
       d.external_id,
       d.name,
       d.risk_color,
       d.always_show,
       COALESCE(SUM(CASE WHEN p.contribution = 'PIS'    THEN p.value ELSE 0 END), 0) AS pis_total,
       COALESCE(SUM(CASE WHEN p.contribution = 'COFINS' THEN p.value ELSE 0 END), 0) AS cofins_total
     FROM credit_point_definitions d
     LEFT JOIN ${table} p
       ON p.credit_point_definition_id = d.id
      AND p.job_id = ?
     WHERE (d.always_show = 1 OR p.job_id IS NOT NULL)
       AND d.category = ?
       AND d.tax_id = (SELECT id FROM taxes WHERE code = 'PIS_COFINS')
     GROUP BY d.id, d.external_id, d.name, d.risk_color, d.always_show
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId, category]
  );

  const ids = rows.map((r) => r.credit_point_definition_id);
  await ensureNoteRowsExist(jobId, ids);
  const notesById = await loadNotesById(jobId, ids);

  return rows.map((r) => {
    const note = notesById.get(r.credit_point_definition_id);
    const pis    = toNumber(r.pis_total);
    const cofins = toNumber(r.cofins_total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id:   r.external_id,
      name:          r.name,
      risk_color:    r.risk_color ?? null,
      is_fixed_point: !!r.always_show,
      pis_total:     pis,
      cofins_total:  cofins,
      total:         pis + cofins,
      breakdown: [
        { label: 'PIS',    value: pis    },
        { label: 'COFINS', value: cofins },
      ],
      observations:  note?.observations  ?? null,
      confirmed:     !!note?.confirmed_in_result,
      review_status: note?.review_status ?? 'PENDING',
      review_note:   note?.review_note   ?? null,
      reviewed_by:   note?.reviewed_by   ?? null,
      reviewed_at:   note?.reviewed_at   ?? null,
    };
  });
}

async function getMonthlyPisCofins(jobId, category, creditPointDefinitionId) {
  const table = tableForCategory(category);

  const [rows] = await pool.query(
    `SELECT
       reference_month,
       SUM(CASE WHEN contribution = 'PIS'    THEN value ELSE 0 END) AS pis_value,
       SUM(CASE WHEN contribution = 'COFINS' THEN value ELSE 0 END) AS cofins_value
     FROM ${table}
     WHERE job_id = ? AND credit_point_definition_id = ?
     GROUP BY reference_month
     ORDER BY reference_month ASC`,
    [jobId, creditPointDefinitionId]
  );

  return rows.map((r) => ({
    period_label: r.reference_month,
    pis_value:    toNumber(r.pis_value),
    cofins_value: toNumber(r.cofins_value),
    total:        toNumber(r.pis_value) + toNumber(r.cofins_value),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// IPI
// ═══════════════════════════════════════════════════════════════════════

async function listPointsIpi(jobId, category) {
  const [rows] = await pool.query(
    `SELECT
       d.id          AS credit_point_definition_id,
       d.external_id,
       d.name,
       d.risk_color,
       d.always_show,
       COALESCE(SUM(p.value), 0) AS total
     FROM credit_point_definitions d
     LEFT JOIN pontos_ipi p
       ON p.credit_point_definition_id = d.id
      AND p.job_id = ?
     WHERE (d.always_show = 1 OR p.job_id IS NOT NULL)
       AND d.category = ?
       AND d.tax_id = (SELECT id FROM taxes WHERE code = 'IPI')
     GROUP BY d.id, d.external_id, d.name, d.risk_color, d.always_show
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId, category]
  );

  const ids = rows.map((r) => r.credit_point_definition_id);
  await ensureNoteRowsExist(jobId, ids);
  const notesById = await loadNotesById(jobId, ids);

  return rows.map((r) => {
    const note  = notesById.get(r.credit_point_definition_id);
    const total = toNumber(r.total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id:    r.external_id,
      name:           r.name,
      risk_color:     r.risk_color ?? null,
      is_fixed_point: !!r.always_show,
      total,
      breakdown: [],
      observations:   note?.observations  ?? null,
      confirmed:      !!note?.confirmed_in_result,
      review_status:  note?.review_status ?? 'PENDING',
      review_note:    note?.review_note   ?? null,
      reviewed_by:    note?.reviewed_by   ?? null,
      reviewed_at:    note?.reviewed_at   ?? null,
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
    total:        toNumber(r.value),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// IRPJ/CSLL
// ═══════════════════════════════════════════════════════════════════════

async function listPointsIrCsll(jobId, category) {
  const [rows] = await pool.query(
    `SELECT
       d.id          AS credit_point_definition_id,
       d.external_id,
       d.name,
       d.risk_color,
       d.always_show,
       COALESCE(SUM(CASE WHEN p.tax_sub_type = 'IRPJ' THEN p.value ELSE 0 END), 0) AS irpj_total,
       COALESCE(SUM(CASE WHEN p.tax_sub_type = 'CSLL' THEN p.value ELSE 0 END), 0) AS csll_total
     FROM credit_point_definitions d
     LEFT JOIN pontos_ir_csll p
       ON p.credit_point_definition_id = d.id
      AND p.job_id = ?
     WHERE (d.always_show = 1 OR p.job_id IS NOT NULL)
       AND d.category = ?
       AND d.tax_id = (SELECT id FROM taxes WHERE code = 'IRPJ_CSLL')
     GROUP BY d.id, d.external_id, d.name, d.risk_color, d.always_show
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
      external_id:    r.external_id,
      name:           r.name,
      risk_color:     r.risk_color ?? null,
      is_fixed_point: !!r.always_show,
      irpj_total:     irpj,
      csll_total:     csll,
      total:          irpj + csll,
      breakdown: [
        { label: 'IRPJ', value: irpj },
        { label: 'CSLL', value: csll },
      ],
      observations:   note?.observations  ?? null,
      confirmed:      !!note?.confirmed_in_result,
      review_status:  note?.review_status ?? 'PENDING',
      review_note:    note?.review_note   ?? null,
      reviewed_by:    note?.reviewed_by   ?? null,
      reviewed_at:    note?.reviewed_at   ?? null,
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
    irpj_value:   toNumber(r.irpj_value),
    csll_value:   toNumber(r.csll_value),
    total:        toNumber(r.irpj_value) + toNumber(r.csll_value),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// INSS
// ═══════════════════════════════════════════════════════════════════════

async function listPointsInss(jobId, category) {
  const [rows] = await pool.query(
    `SELECT
       d.id          AS credit_point_definition_id,
       d.external_id,
       d.name,
       d.risk_color,
       d.always_show,
       COALESCE(SUM(p.value), 0) AS total
     FROM credit_point_definitions d
     LEFT JOIN pontos_inss p
       ON p.credit_point_definition_id = d.id
      AND p.job_id = ?
     WHERE (d.always_show = 1 OR p.job_id IS NOT NULL)
       AND d.category = ?
       AND d.tax_id = (SELECT id FROM taxes WHERE code = 'INSS')
     GROUP BY d.id, d.external_id, d.name, d.risk_color, d.always_show
     ORDER BY d.name ASC, d.external_id ASC`,
    [jobId, category]
  );

  const ids = rows.map((r) => r.credit_point_definition_id);
  await ensureNoteRowsExist(jobId, ids);
  const notesById = await loadNotesById(jobId, ids);

  return rows.map((r) => {
    const note  = notesById.get(r.credit_point_definition_id);
    const total = toNumber(r.total);
    return {
      credit_point_definition_id: r.credit_point_definition_id,
      external_id:    r.external_id,
      name:           r.name,
      risk_color:     r.risk_color ?? null,
      is_fixed_point: !!r.always_show,
      total,
      breakdown: [],
      observations:   note?.observations  ?? null,
      confirmed:      !!note?.confirmed_in_result,
      review_status:  note?.review_status ?? 'PENDING',
      review_note:    note?.review_note   ?? null,
      reviewed_by:    note?.reviewed_by   ?? null,
      reviewed_at:    note?.reviewed_at   ?? null,
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
    total:        toNumber(r.value),
  }));
}

// ═══════════════════════════════════════════════════════════════════════
// Endpoints de rota
// ═══════════════════════════════════════════════════════════════════════

async function listPoints(req, res, next) {
  try {
    const { jobId }   = req.params;
    const { category } = req.query;
    assertValidCategory(category);
    const tax = resolveTax(req.query.tax);
    await assertJobExists(jobId);

    if (tax === 'IPI')        return res.json({ data: await listPointsIpi(jobId, category) });
    if (tax === 'IRPJ_CSLL') return res.json({ data: await listPointsIrCsll(jobId, category) });
    if (tax === 'INSS')       return res.json({ data: await listPointsInss(jobId, category) });
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

    if (tax === 'IPI')        return res.json({ data: await getMonthlyIpi(jobId, creditPointDefinitionId) });
    if (tax === 'IRPJ_CSLL') return res.json({ data: await getMonthlyIrCsll(jobId, creditPointDefinitionId) });
    if (tax === 'INSS')       return res.json({ data: await getMonthlyInss(jobId, creditPointDefinitionId) });
    res.json({ data: await getMonthlyPisCofins(jobId, category, creditPointDefinitionId) });
  } catch (err) {
    next(err);
  }
}

// ─── PUT .../diagnostics/points/:id ──────────────────────────────────────────
// Analista: atualiza observations → review_status volta para PENDING
//           (qualquer edição nas observations invalida aprovação anterior)
// Admin:    pode atualizar observations E review_note E review_status em
//           uma única chamada — usado quando o admin quer ajustar
//           manualmente via campo de texto (fluxo avançado).
//           Para aprovação/devolução simples, usar PATCH .../review abaixo.
async function updateNote(req, res, next) {
  try {
    const { jobId, creditPointDefinitionId } = req.params;
    const { observations, review_note, review_status } = req.body;
    const isAdmin = req.user.role === 'admin';

    await assertJobExists(jobId);

    // Confirma que o ponto pertence a este job OU é um ponto fixo (always_show = 1).
    // Pontos fixos sem dados importados não aparecem em nenhuma pontos_* table,
    // mas ainda devem aceitar anotações do analista.
    const [related] = await pool.query(
      `SELECT 1 FROM pontos_adm          WHERE job_id = ? AND credit_point_definition_id = ?
       UNION
       SELECT 1 FROM pontos_ftx          WHERE job_id = ? AND credit_point_definition_id = ?
       UNION
       SELECT 1 FROM pontos_ipi          WHERE job_id = ? AND credit_point_definition_id = ?
       UNION
       SELECT 1 FROM pontos_ir_csll      WHERE job_id = ? AND credit_point_definition_id = ?
       UNION
       SELECT 1 FROM pontos_inss         WHERE job_id = ? AND credit_point_definition_id = ?
       UNION
       SELECT 1 FROM credit_point_definitions WHERE id = ? AND always_show = 1
       LIMIT 1`,
      [
        jobId, creditPointDefinitionId,
        jobId, creditPointDefinitionId,
        jobId, creditPointDefinitionId,
        jobId, creditPointDefinitionId,
        jobId, creditPointDefinitionId,
        creditPointDefinitionId,
      ]
    );
    if (!related[0]) throw new ApiError(404, 'Ponto não encontrado para este job.');

    // Campos que todos podem alterar
    const fields = { observations: observations ?? null };

    if (isAdmin) {
      // Admin pode enviar review_note junto, mas review_status via este endpoint
      // só é aceito se for explicitamente enviado — preferir usar /review
      if (review_note !== undefined) fields.review_note = review_note ?? null;
      if (review_status !== undefined) {
        if (!VALID_REVIEW_STATUSES.includes(review_status)) {
          throw new ApiError(400, `review_status inválido. Use: ${VALID_REVIEW_STATUSES.join(', ')}.`);
        }
        fields.review_status = review_status;
        if (review_status === 'APPROVED' || review_status === 'NEEDS_REVIEW') {
          fields.reviewed_by = req.user.id;
          fields.reviewed_at = new Date();
        }
      } else {
        // Admin editou observations mas não mandou review_status → volta para PENDING
        if (observations !== undefined) {
          fields.review_status = 'PENDING';
          fields.reviewed_by   = null;
          fields.reviewed_at   = null;
        }
      }
    } else {
      // Analista: qualquer edição de observations → volta para PENDING
      fields.review_status = 'PENDING';
      fields.reviewed_by   = null;
      fields.reviewed_at   = null;
    }

    // Monta SET dinâmico
    const setClauses = Object.keys(fields).map((k) => `${k} = ?`).join(', ');
    const setValues  = Object.values(fields);

    await pool.query(
      `INSERT INTO job_point_notes (job_id, credit_point_definition_id, ${Object.keys(fields).join(', ')})
       VALUES (?, ?, ${Object.keys(fields).map(() => '?').join(', ')})
       ON DUPLICATE KEY UPDATE ${setClauses}`,
      [jobId, creditPointDefinitionId, ...setValues, ...setValues]
    );

    const [rows] = await pool.query(
      `SELECT job_id, credit_point_definition_id, observations, confirmed_in_result,
              review_status, review_note, reviewed_by, reviewed_at, updated_at
       FROM job_point_notes WHERE job_id = ? AND credit_point_definition_id = ?`,
      [jobId, creditPointDefinitionId]
    );

    await logService.record(req, {
      action:     'JOB_POINT_NOTE_UPDATED',
      entityType: 'job_point_notes',
      entityId:   Number(creditPointDefinitionId),
      jobId:      Number(jobId),
      details:    { observations, review_note, review_status, role: req.user.role },
    });

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ─── PATCH .../review  [admin only] ──────────────────────────────────────────
// Endpoint dedicado para o admin aprovar ou devolver um ponto.
// Não toca em observations — só altera review_status e review_note.
//
// Body:
//   { review_status: 'APPROVED' | 'NEEDS_REVIEW', review_note?: string }
//
// Regras:
//   - APPROVED:      limpa review_note, grava reviewed_by/reviewed_at
//   - NEEDS_REVIEW:  review_note é obrigatório, grava reviewed_by/reviewed_at
async function reviewPoint(req, res, next) {
  try {
    const { jobId, creditPointDefinitionId } = req.params;
    const { review_status, review_note }     = req.body;

    if (req.user.role !== 'admin') {
      throw new ApiError(403, 'Apenas administradores podem validar pontos.');
    }

    if (!['APPROVED', 'NEEDS_REVIEW'].includes(review_status)) {
      throw new ApiError(400, 'review_status deve ser "APPROVED" ou "NEEDS_REVIEW".');
    }

    if (review_status === 'NEEDS_REVIEW' && (!review_note || !review_note.trim())) {
      throw new ApiError(400, 'Uma nota de revisão é obrigatória ao devolver um ponto.');
    }

    await assertJobExists(jobId);

    // Garante que a linha existe antes de tentar atualizar
    await pool.query(
      `INSERT IGNORE INTO job_point_notes (job_id, credit_point_definition_id)
       VALUES (?, ?)`,
      [jobId, creditPointDefinitionId]
    );

    const now        = new Date();
    const noteToSave = review_status === 'APPROVED' ? null : (review_note?.trim() ?? null);

    await pool.query(
      `UPDATE job_point_notes
       SET review_status = ?,
           review_note   = ?,
           reviewed_by   = ?,
           reviewed_at   = ?
       WHERE job_id = ? AND credit_point_definition_id = ?`,
      [review_status, noteToSave, req.user.id, now, jobId, creditPointDefinitionId]
    );

    const [rows] = await pool.query(
      `SELECT job_id, credit_point_definition_id, observations, confirmed_in_result,
              review_status, review_note, reviewed_by, reviewed_at, updated_at
       FROM job_point_notes WHERE job_id = ? AND credit_point_definition_id = ?`,
      [jobId, creditPointDefinitionId]
    );

    await logService.record(req, {
      action:     review_status === 'APPROVED' ? 'JOB_POINT_APPROVED' : 'JOB_POINT_NEEDS_REVIEW',
      entityType: 'job_point_notes',
      entityId:   Number(creditPointDefinitionId),
      jobId:      Number(jobId),
      details:    { review_status, review_note: noteToSave },
    });

    const allApproved = await checkAllPointsApproved(jobId);

    // Marco de produtividade: registra quando TODOS os pontos ficam aprovados.
    // Acontece apenas quando esta aprovação específica é a que fecha o conjunto.
    if (review_status === 'APPROVED' && allApproved) {
      await logService.record(req, {
        action:     'ALL_POINTS_APPROVED',
        entityType: 'job',
        entityId:   Number(jobId),
        jobId:      Number(jobId),
        details:    { last_point_id: Number(creditPointDefinitionId) },
      });
    }

    res.json({ data: rows[0], meta: { all_points_approved: allApproved } });
  } catch (err) {
    next(err);
  }
}

// ─── GET .../progress  ────────────────────────────────────────────────────────
// Retorna o progresso de validação do Diagnóstico para o job.
// Usado pelo frontend para calcular % e exibir flag na lista de jobs.
async function getProgress(req, res, next) {
  try {
    const { jobId } = req.params;
    await assertJobExists(jobId);

    const progress    = await getDiagnosticProgress(jobId);
    const allApproved = progress.total > 0 && progress.APPROVED === progress.total;

    res.json({
      data: {
        ...progress,
        all_approved: allApproved,
        percentage:   progress.total === 0
          ? 0
          : Math.round((progress.APPROVED / progress.total) * 100),
      },
    });
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// GERAR PARECER TÉCNICO (PDF)
// POST /jobs/:jobId/resultado/gerar-parecer
// Body: { observations: string }
// ═══════════════════════════════════════════════════════════════════════

async function generateParecer(req, res, next) {
  try {
    const { jobId }      = req.params;
    const { observations } = req.body;

    if (!observations || !String(observations).trim()) {
      throw new ApiError(400, 'As observações técnicas são obrigatórias.');
    }

    await assertJobExists(jobId);

    const [jobRows] = await pool.query(
      `SELECT j.job_number, c.company_name
       FROM jobs j
       JOIN clients c ON c.id = j.client_id
       WHERE j.id = ?`,
      [jobId]
    );
    if (!jobRows[0]) throw new ApiError(404, 'Job não encontrado.');
    const job    = jobRows[0];
    const obsText = String(observations).trim();

    // ── Lê o template .docx ──────────────────────────────────────────
    const templatePath = path.join(__dirname, '../templates/parecer_template.docx');
    if (!fs.existsSync(templatePath)) {
      throw new ApiError(500, 'Template do parecer não encontrado. Coloque o arquivo em backend/templates/parecer_template.docx');
    }

    const zip = new AdmZip(fs.readFileSync(templatePath));
    let xml   = zip.readAsText('word/document.xml');

    // ── Utilitários ──────────────────────────────────────────────────
    /** Escapa caracteres reservados do XML */
    const esc = (s) => String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');

    /**
     * Converte texto simples em runs do Word.
     * Quebras de linha viram <w:br/>.
     */
    const textToRuns = (text) =>
      esc(text)
        .split('\n')
        .map((line, i) =>
          i === 0
            ? `<w:r><w:t xml:space="preserve">${line}</w:t></w:r>`
            : `<w:r><w:br/><w:t xml:space="preserve">${line}</w:t></w:r>`
        )
        .join('');

    const today = new Date().toLocaleDateString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });

    // ── Substituições no XML ─────────────────────────────────────────

    // 1. Empresa Contratante
    xml = xml.replace(
      '>Empresa Contratante:</w:t></w:r><w:r><w:rPr><w:rFonts w:eastAsia="Arial Unicode MS" w:cstheme="minorHAnsi"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>',
      `>Empresa Contratante:</w:t></w:r><w:r><w:rPr><w:rFonts w:eastAsia="Arial Unicode MS" w:cstheme="minorHAnsi"/></w:rPr><w:t xml:space="preserve"> ${esc(job.company_name)}</w:t></w:r>`
    );

    // 2. Data do término do trabalho
    xml = xml.replace(
      '>Data do término do trabalho:</w:t></w:r><w:r><w:rPr><w:rFonts w:eastAsia="Arial Unicode MS" w:cstheme="minorHAnsi"/></w:rPr><w:t xml:space="preserve"> </w:t></w:r>',
      `>Data do término do trabalho:</w:t></w:r><w:r><w:rPr><w:rFonts w:eastAsia="Arial Unicode MS" w:cstheme="minorHAnsi"/></w:rPr><w:t xml:space="preserve"> ${today}</w:t></w:r>`
    );

    // 3. Parágrafo de observações — substitui os 3 runs do texto de conclusão
    xml = xml.replace(
      '<w:r><w:t xml:space="preserve">Tendo em vista estas observações e os documentos analisados, </w:t></w:r>' +
      '<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">não identificamos oportunidades de créditos</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve"> nos pontos passíveis de análise.</w:t></w:r>',
      textToRuns(obsText)
    );

    // ── Salva e envia ────────────────────────────────────────────────
    zip.updateFile('word/document.xml', Buffer.from(xml, 'utf8'));
    const docxBuffer = zip.toBuffer();

    const safeNum = String(job.job_number ?? jobId).replace(/[^a-zA-Z0-9_\-]/g, '_');
    const filename = `Parecer_${safeNum}.docx`;

    res.set({
      'Content-Type':        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      docxBuffer.length,
    });
    res.send(docxBuffer);

    await logService.record(req, {
      action:     'PARECER_GERADO',
      entityType: 'jobs',
      entityId:   Number(jobId),
      jobId:      Number(jobId),
      details:    { obs_len: obsText.length },
    });
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
// GERAR DIAGNÓSTICO PDF
// POST /jobs/:jobId/diagnostics/gerar-pdf
// Body: DiagnosticPdfFormData
// ═══════════════════════════════════════════════════════════════════════

async function generateDiagnosticoPdf(req, res, next) {
  try {
    const { jobId } = req.params;
    const {
      q1_paga_darf,
      q2_pis_cofins_mes,
      q2_irpj_csll_mes,
      q2_inss_mes,
      q2_ipi_mes,
      q3_recolhimento,
      q4_oportunidades_500k,
      q5_credita_risco,
      q6_dividas_rfb,
      q7_explique,
      obs,
    } = req.body;

    await assertJobExists(jobId);

    const [jobRows] = await pool.query(
      `SELECT j.job_number, j.tax_regime, c.company_name
       FROM jobs j
       JOIN clients c ON c.id = j.client_id
       WHERE j.id = ?`,
      [jobId]
    );
    if (!jobRows[0]) throw new ApiError(404, 'Job não encontrado.');
    const job = jobRows[0];

    // ── PDF em Landscape A4 (igual à planilha Excel) ────────────────
    const doc    = new PDFDocument({ size: 'A4', layout: 'landscape', margin: 35 });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    const pdfDone = new Promise((resolve, reject) => {
      doc.on('end',   resolve);
      doc.on('error', reject);
    });

    const M   = 35;                          // margem
    const pgW = doc.page.width  - M * 2;    // ~772pt
    const pgH = doc.page.height - M * 2;    // ~525pt

    // Paleta idêntica ao Excel
    const C = {
      brown:      '#5c3d1e',   // cabeçalho principal das tabelas
      brownMid:   '#7a5230',   // label ADM / FINTAX
      beige:      '#f2e8dc',   // linha alternada clara
      white:      '#ffffff',
      border:     '#b8a090',
      text:       '#1a1a1a',
      textHdr:    '#ffffff',
      titleBg:    '#d6c8b8',   // faixa do título
      verde:      '#e8f5e9',
      amarelo:    '#fffde7',
      vermelho:   '#fdecea',
      totalBg:    '#4a3010',   // linha TOTAL
      tempoTotal: '#8B7355',   // faixa TEMPO TOTAL
      yellow:     '#f5c518',   // texto TEMPO TOTAL
      red:        '#cc0000',   // valores em vermelho no Q2
    };

    const checkPageBreak = (h = 60) => {
      if (doc.y > M + pgH - h) doc.addPage();
    };

    // Caixa de resposta com texto do usuário
    const answerBox = (text, minH = 18) => {
      checkPageBreak(minH + 16);
      const t  = String(text ?? '').trim();
      const bH = Math.max(
        doc.heightOfString(t || ' ', { width: pgW - 12, fontSize: 9, lineGap: 1 }),
        minH
      ) + 8;
      const y0 = doc.y;
      doc.rect(M, y0, pgW, bH).fillAndStroke('#fafafa', C.border);
      if (t) {
        doc.font('Helvetica').fontSize(9).fillColor(C.text)
          .text(t, M + 6, y0 + 4, { width: pgW - 12, lineGap: 1 });
      }
      doc.y = y0 + bH + 5;
      doc.x = M;
    };

    const qLabel = (text, sz = 9) => {
      checkPageBreak(24);
      doc.font('Helvetica-Bold').fontSize(sz).fillColor(C.text).text(text, M, doc.y);
      doc.moveDown(0.2);
    };

    const subLabel = (text) => {
      doc.font('Helvetica').fontSize(8).fillColor('#555').text(text, M + 8, doc.y);
      doc.moveDown(0.1);
    };

    // Desenha uma tabela genérica retornando a altura total usada
    // cols: [{ w, label, subLabel? }]
    // rows: [string[]]
    // rowH: altura de cada linha de dados
    // hdrH: altura do cabeçalho
    const drawTable = ({ x, y, cols, rows, rowH = 15, hdrH = 26, totalRow = null }) => {
      let cx = x;
      // Cabeçalho
      cols.forEach((col) => {
        doc.rect(cx, y, col.w, hdrH).fillAndStroke(C.brown, C.brown);
        doc.font('Helvetica-Bold').fontSize(6).fillColor(C.textHdr)
          .text(col.label, cx + 2, y + 3, {
            width: col.w - 4, align: 'center', lineGap: 1,
            height: hdrH - 4, ellipsis: false,
          });
        cx += col.w;
      });

      // Linhas de dados
      rows.forEach((row, ri) => {
        const ry = y + hdrH + ri * rowH;
        const bg = ri % 2 === 0 ? C.white : C.beige;
        cx = x;
        cols.forEach((col, ci) => {
          doc.rect(cx, ry, col.w, rowH).fillAndStroke(bg, C.border);
          const cell  = String(row[ci] ?? '');
          const isBold = ci === 0;
          doc.font(isBold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(7).fillColor(C.text)
            .text(cell, cx + 3, ry + 4, { width: col.w - 6, lineBreak: false });
          cx += col.w;
        });
      });

      // Linha de total opcional
      let totalH = 0;
      if (totalRow) {
        const ty = y + hdrH + rows.length * rowH;
        totalH   = rowH;
        cx = x;
        cols.forEach((col, ci) => {
          doc.rect(cx, ty, col.w, rowH).fillAndStroke(C.totalBg, C.totalBg);
          doc.font('Helvetica-Bold').fontSize(7).fillColor(C.textHdr)
            .text(String(totalRow[ci] ?? ''), cx + 3, ty + 4, { width: col.w - 6, lineBreak: false });
          cx += col.w;
        });
      }

      return hdrH + rows.length * rowH + totalH;
    };

    // Desenha as duas subtabelas de UTILIZAÇÃO lado a lado
    // leftTitle: "COMPENSAÇÃO DOS CRÉDITOS PRT" ou "FINTAX"
    const drawUtilizacao = (y, leftTitle) => {
      const halfW = pgW * 0.48;
      const gap   = 6;
      const rightW = pgW - halfW - gap;
      const lx = M, rx = M + halfW + gap;
      const hH = 15, rH = 14;

      // Cabeçalhos principais
      doc.rect(lx, y, halfW, hH).fillAndStroke(C.brownMid, C.brownMid);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.textHdr)
        .text(leftTitle, lx + 3, y + 4, { width: halfW - 6, align: 'center', lineBreak: false });

      doc.rect(rx, y, rightW, hH).fillAndStroke(C.brownMid, C.brownMid);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.textHdr)
        .text('COMPENSAÇÃO DOS CRÉDITOS ESCRITURAIS', rx + 3, y + 4, { width: rightW - 6, align: 'center', lineBreak: false });

      // Sub-cabeçalhos
      const subY  = y + hH;
      const lCols = [halfW * 0.22, halfW * 0.39, halfW * 0.39];
      const lHdrs = ['TRIBUTO', 'Tempo de Utilização (meses)', 'Com quais tributos?'];
      let cx = lx;
      lHdrs.forEach((h, i) => {
        doc.rect(cx, subY, lCols[i], hH).fillAndStroke(C.brown, C.brown);
        doc.font('Helvetica-Bold').fontSize(6).fillColor(C.textHdr)
          .text(h, cx + 2, subY + 4, { width: lCols[i] - 4, align: 'center', lineBreak: false });
        cx += lCols[i];
      });
      const rCols = [rightW * 0.30, rightW * 0.70];
      const rHdrs = ['TRIBUTO', 'Tempo de Utilização (meses)'];
      cx = rx;
      rHdrs.forEach((h, i) => {
        doc.rect(cx, subY, rCols[i], hH).fillAndStroke(C.brown, C.brown);
        doc.font('Helvetica-Bold').fontSize(6).fillColor(C.textHdr)
          .text(h, cx + 2, subY + 4, { width: rCols[i] - 4, align: 'center', lineBreak: false });
        cx += rCols[i];
      });

      // Linha de dados esquerda: TODOS | - | TODOS
      const dataY = subY + hH;
      const dataH = rH * 3; // alinha com 3 linhas da direita
      cx = lx;
      ['TODOS', '-', 'TODOS'].forEach((txt, i) => {
        doc.rect(cx, dataY, lCols[i], dataH).fillAndStroke(C.white, C.border);
        doc.font('Helvetica').fontSize(7).fillColor(C.text)
          .text(txt, cx + 3, dataY + 5, { width: lCols[i] - 6, lineBreak: false });
        cx += lCols[i];
      });

      // Coluna TRIBUTO direita: PIS/COFINS, IRPJ/CSLL, INSS (uma por linha)
      const tributos = ['PIS/COFINS', 'IRPJ/CSLL', 'INSS'];
      tributos.forEach((t, ri) => {
        const ry = dataY + ri * rH;
        // tributo cell
        doc.rect(rx, ry, rCols[0], rH).fillAndStroke(ri % 2 === 0 ? C.white : C.beige, C.border);
        doc.font('Helvetica').fontSize(7).fillColor(C.text)
          .text(t, rx + 3, ry + 4, { width: rCols[0] - 6, lineBreak: false });
        // tempo cell
        doc.rect(rx + rCols[0], ry, rCols[1], rH).fillAndStroke(ri % 2 === 0 ? C.white : C.beige, C.border);
        doc.font('Helvetica').fontSize(7).fillColor(C.text)
          .text('-', rx + rCols[0] + 3, ry + 4, { lineBreak: false });
      });

      // TEMPO DE UTILIZAÇÃO
      const tempoY2 = dataY + rH * 3;
      doc.rect(lx, tempoY2, halfW, hH).fillAndStroke(C.brown, C.brown);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.textHdr)
        .text('TEMPO DE UTILIZAÇÃO:', lx + 3, tempoY2 + 4, { width: halfW - 6, lineBreak: false });
      doc.rect(rx, tempoY2, rightW, hH).fillAndStroke(C.brown, C.brown);
      doc.font('Helvetica-Bold').fontSize(7).fillColor(C.textHdr)
        .text('TEMPO DE UTILIZAÇÃO:', rx + 3, tempoY2 + 4, { width: rightW - 6, lineBreak: false });

      return hH * 3 + rH * 3 + hH; // altura total usada
    };

    // ════════════════════════════════════════════════════════════════
    // PÁGINA 1 — Título + cabeçalho + Q1–Q6
    // ════════════════════════════════════════════════════════════════

    // Faixa do título
    doc.rect(M, M, pgW, 18).fill(C.titleBg);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.text)
      .text('DIAGNÓSTICO PONTOS CRÉDITO - PRT E FINTAX', M, M + 4, { align: 'center', width: pgW });

    // Cabeçalho simples (texto, sem células)
    doc.y = M + 22;
    doc.x = M;
    [
      `Nº JOB: ${job.job_number    ?? '0'}`,
      `RAZÃO SOCIAL: ${job.company_name ?? '0'}`,
      `REGIME DE APURAÇÃO: ${job.tax_regime ?? '0'}`,
    ].forEach((line) => {
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.text).text(line, M, doc.y);
      doc.moveDown(0.35);
    });
    doc.moveDown(0.4);

    // Q1
    qLabel('1.  A empresa que você está analisando paga DARF?');
    subLabel('Resposta:');
    answerBox(q1_paga_darf);

    // Q2
    qLabel('2.  Qual valor médio por Tributo/mês? (Necessário ter soma de 500mil/ano)');

    const q2Pis  = parseFloat(q2_pis_cofins_mes) || 0;
    const q2Irpj = parseFloat(q2_irpj_csll_mes)  || 0;
    const q2Inss = parseFloat(q2_inss_mes)        || 0;
    const q2Ipi  = parseFloat(q2_ipi_mes)         || 0;
    const totalAno = (q2Pis + q2Irpj + q2Inss + q2Ipi) * 12;

    const fmtNum = (n) => n.toLocaleString('pt-BR', { minimumFractionDigits: 2 });

    // Labels MÊS e ANO
    const q2TableW = pgW * 0.56;
    const q2C = [q2TableW * 0.28, q2TableW * 0.36, q2TableW * 0.36];
    const q2rH = 16;
    const q2y0 = doc.y;

    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.text)
      .text('MÊS', M + q2C[0], q2y0, { width: q2C[1], align: 'center', lineBreak: false });
    doc.text('ANO', M + q2C[0] + q2C[1], q2y0, { width: q2C[2], align: 'center', lineBreak: false });
    doc.y = q2y0 + 12;

    [
      { label: 'PIS/COFINS:', v: q2Pis  },
      { label: 'IRPJ/CSLL:', v: q2Irpj },
      { label: 'INSS',       v: q2Inss },
      { label: 'IPI',        v: q2Ipi  },
    ].forEach(({ label, v }) => {
      const ry = doc.y;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(C.text)
        .text(label, M, ry, { width: q2C[0], align: 'right', lineBreak: false });
      doc.font('Helvetica').fontSize(8).fillColor(C.red)
        .text(`R$ ${fmtNum(v)}`, M + q2C[0] + 3, ry, { width: q2C[1] - 6, lineBreak: false });
      doc.fillColor(C.text).fontSize(8)
        .text(`R$`, M + q2C[0] + q2C[1], ry, { width: 18, lineBreak: false });
      doc.text(fmtNum(v * 12), M + q2C[0] + q2C[1] + 18, ry, { lineBreak: false });
      doc.y = ry + q2rH;
      doc.x = M;
    });

    // TOTAL ANO
    const taY = doc.y;
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.text)
      .text('TOTAL ANO: ', M, taY, { continued: true });
    doc.fillColor(C.red).text(`R$ ${fmtNum(totalAno)}`);
    doc.y = taY + 16;
    doc.x = M;
    doc.moveDown(0.3);

    // Q3
    qLabel('3.  Como é realizado o recolhimento dos débitos? DARF, Parcelamento, Compensação (teses), Saldo Credor...?');
    subLabel('Resposta:');
    answerBox(q3_recolhimento);

    // Q4
    qLabel('4.  As oportunidades somam valor maior que 500mil?');
    subLabel('Resposta:');
    answerBox(q4_oportunidades_500k);

    // Q5
    qLabel('5.  A empresa já se credita de algum ponto de Risco? (reforçar nosso argumento)');
    subLabel('Resposta:');
    answerBox(q5_credita_risco);

    // Q6
    qLabel('6.  Empresa possui dívidas com a RFB? (parcelamentos)');
    subLabel('Resposta:');
    answerBox(q6_dividas_rfb);

    // ════════════════════════════════════════════════════════════════
    // Q7 — nova página para a parte de tabelas
    // ════════════════════════════════════════════════════════════════
    doc.addPage();

    // Repete faixa do título na 2ª página
    doc.rect(M, M, pgW, 18).fill(C.titleBg);
    doc.font('Helvetica-Bold').fontSize(11).fillColor(C.text)
      .text('DIAGNÓSTICO PONTOS CRÉDITO - PRT E FINTAX', M, M + 4, { align: 'center', width: pgW });
    doc.y = M + 24;
    doc.x = M;

    qLabel('7.  Diante desse cenário, como a empresa irá utilizar os valores dos Pontos de Créditos? (Restituição, Ressarcimento, Escritural ou Extemporâneo)');
    subLabel('Explique:');
    answerBox(q7_explique);
    doc.moveDown(0.3);

    // ── Label ADM ───────────────────────────────────────────────────
    const admLY = doc.y;
    doc.rect(M, admLY, 50, 14).fill(C.brownMid);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.textHdr)
      .text('ADM', M + 4, admLY + 3, { lineBreak: false });
    doc.y = admLY + 18;
    doc.x = M;

    // ── Tabela ADM (8 colunas) ──────────────────────────────────────
    const admColsRaw = [70, 88, 98, 88, 98, 88, 88, 80];
    const admScale   = pgW / admColsRaw.reduce((a, b) => a + b, 0);
    const admCols    = admColsRaw.map((w, i) => ({
      w: w * admScale,
      label: [
        'TRIBUTOS',
        'CRÉDITOS',
        'RESTITUIÇÃO/\nSALDO NEGATIVO',
        'RESSARCIMENTO',
        'ESCRITURAL/\nPREJUÍZO FISCAL',
        'REVISÃO DE\nPARCELAMENTO',
        'ATUALIZAÇÃO\nMONETÁRIA',
        'Economia Tributária\nIRPJ/CSLL (JCP)',
      ][i],
    }));

    const admRows = [
      ['PIS/COFINS', 'R$', 'R$', 'R$', 'R$', '', 'R$', ''],
      ['IRPJ/CSLL',  'R$', 'R$', 'R$', 'R$', '', 'R$', 'R$'],
      ['IPI',        'R$', '',   '',   '',   '', '',   ''],
      ['INSS',       'R$', 'R$', '',   '',   '', '',   ''],
    ];

    const admH = drawTable({
      x: M, y: doc.y,
      cols: admCols,
      rows: admRows,
      rowH: 14, hdrH: 26,
      totalRow: ['TOTAL', 'R$', 'R$', 'R$', 'R$', 'R$', 'R$', 'R$'],
    });
    doc.y += admH + 8;
    doc.x = M;

    // ── UTILIZAÇÃO (ADM) ────────────────────────────────────────────
    qLabel('UTILIZAÇÃO:');
    const utilADMH = drawUtilizacao(doc.y, 'COMPENSAÇÃO DOS CRÉDITOS PRT');
    doc.y += utilADMH + 10;
    doc.x = M;

    // ── Label FINTAX ─────────────────────────────────────────────────
    checkPageBreak(200);
    const ftxLY = doc.y;
    doc.rect(M, ftxLY, 56, 14).fill(C.brownMid);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.textHdr)
      .text('FINTAX', M + 4, ftxLY + 3, { lineBreak: false });
    doc.y = ftxLY + 18;
    doc.x = M;

    // ── Tabela FINTAX (9 colunas) ─────────────────────────────────
    const ftxColsRaw = [55, 90, 72, 88, 78, 88, 82, 78, 78];
    const ftxScale   = pgW / ftxColsRaw.reduce((a, b) => a + b, 0);
    const ftxCols    = ftxColsRaw.map((w, i) => ({
      w: w * ftxScale,
      label: [
        'TRIBUTOS',
        'CLASSIFICAÇÃO\nDE RISCO',
        'CRÉDITOS',
        'RESTITUIÇÃO/\nSALDO NEGATIVO',
        'RESSARCIMENTO',
        'ESCRITURAL/\nPREJUÍZO FISCAL',
        'Economia Tributária\nIRPJ/CSLL (JCP)',
        'ATUALIZAÇÃO\nMONETÁRIA',
        'ORIENTAÇÃO\nJUDICIAL',
      ][i],
    }));

    // Constrói linhas com cor de fundo baseada na classificação
    const ftxRiskGroups = [
      { cor: 'VERDE',    bg: C.verde,    tributos: ['PIS/COFINS', 'IRPJ/CSLL', 'INSS'] },
      { cor: 'AMARELO',  bg: C.amarelo,  tributos: ['PIS/COFINS', 'IRPJ/CSLL', 'INSS'] },
      { cor: 'VERMELHO', bg: C.vermelho, tributos: ['PIS/COFINS', 'IRPJ/CSLL', 'INSS'] },
    ];

    // Desenha manualmente pois as linhas têm fundo variável por grupo
    const ftxTop  = doc.y;
    const ftxHdrH = 26;
    const ftxRH   = 14;
    let cx = M;
    ftxCols.forEach((col) => {
      doc.rect(cx, ftxTop, col.w, ftxHdrH).fillAndStroke(C.brown, C.brown);
      doc.font('Helvetica-Bold').fontSize(5.8).fillColor(C.textHdr)
        .text(col.label, cx + 2, ftxTop + 3, {
          width: col.w - 4, align: 'center', lineGap: 1,
          height: ftxHdrH - 4,
        });
      cx += col.w;
    });

    let ftxRow = 0;
    ftxRiskGroups.forEach(({ cor, bg, tributos }) => {
      tributos.forEach((trib) => {
        const ry = ftxTop + ftxHdrH + ftxRow * ftxRH;
        cx = M;
        ftxCols.forEach((col, ci) => {
          doc.rect(cx, ry, col.w, ftxRH).fillAndStroke(bg, C.border);
          const cell = ci === 0 ? cor : ci === 1 ? trib : 'R$';
          const bold = ci < 2;
          // Linhas de RESSARCIMENTO e ESCRITURAL só para VERDE e VERMELHO
          const showR$  = !(ci >= 2 && cor === 'AMARELO' && ci === 4);
          doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(6.5).fillColor(C.text)
            .text(showR$ ? cell : '', cx + 3, ry + 4, { width: col.w - 6, lineBreak: false });
          cx += col.w;
        });
        ftxRow++;
      });
    });

    // Linha TOTAL
    const ftxTotY = ftxTop + ftxHdrH + ftxRow * ftxRH;
    cx = M;
    ftxCols.forEach((col, ci) => {
      doc.rect(cx, ftxTotY, col.w, ftxRH).fillAndStroke(C.totalBg, C.totalBg);
      doc.font('Helvetica-Bold').fontSize(6.5).fillColor(C.textHdr)
        .text(ci === 0 ? 'TOTAL' : 'R$ 0,00', cx + 3, ftxTotY + 4, { width: col.w - 6, lineBreak: false });
      cx += col.w;
    });
    doc.y = ftxTotY + ftxRH + 10;
    doc.x = M;

    // ════════════════════════════════════════════════════════════════
    // Q8 — Em quanto tempo conseguirá utilizar os valores?
    // ════════════════════════════════════════════════════════════════
    checkPageBreak(120);
    qLabel('8.  Em quanto tempo conseguirá utilizar os valores?');

    const utilFTXH = drawUtilizacao(doc.y, 'COMPENSAÇÃO DOS CRÉDITOS FINTAX');
    doc.y += utilFTXH;
    doc.x = M;

    // TEMPO TOTAL
    const ttY = doc.y;
    doc.rect(M, ttY, pgW, 15).fill(C.tempoTotal);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(C.yellow)
      .text('TEMPO TOTAL:', M + 6, ttY + 4, { lineBreak: false });
    doc.y = ttY + 15 + 10;
    doc.x = M;

    // ── Obs ─────────────────────────────────────────────────────────
    checkPageBreak(32);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(C.text).text('Obs:', M, doc.y);
    doc.moveDown(0.15);
    answerBox(obs ?? '', 24);

    // ── Encerra ──────────────────────────────────────────────────────
    doc.end();
    await pdfDone;

    const pdfBuffer = Buffer.concat(chunks);
    const filename  = `Diagnostico_${job.job_number ?? jobId}.pdf`;

    res.set({
      'Content-Type':        'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Content-Length':      pdfBuffer.length,
    });
    res.send(pdfBuffer);

    await logService.record(req, {
      action:     'DIAGNOSTICO_PDF_GERADO',
      entityType: 'jobs',
      entityId:   Number(jobId),
      jobId:      Number(jobId),
      details:    { form: req.body },
    });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  // ── handlers de rota ──────────────────────────────────────────────
  listPoints,
  getMonthly,
  updateNote,
  reviewPoint,
  getProgress,
  generateParecer,
  generateDiagnosticoPdf,

  // ── exportados para outros controllers ────────────────────────────
  // resultado.controller.js usa para guard antes de gerar PPT
  checkAllPointsApproved,
  // resultado.controller.js usa para popular o summary com dados de validação
  getDiagnosticProgress,

  // resultado.controller.js usa para popular pontos confirmados
  listPointsPisCofins,
  listPointsIpi,
  listPointsIrCsll,
  listPointsInss,
};