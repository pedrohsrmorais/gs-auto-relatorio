const { pool } = require('../config/database');

/* =====================================================================
 * logs.controller.js — visualização do log de auditoria (admin-only).
 *
 * Rotas:
 *   GET /logs                   → list()            — todos os logs paginados
 *   GET /logs/actions           → listActions()     — valores distintos de action
 *   GET /logs/productivity      → getProductivity() — métricas temporais por job
 *   GET /jobs/:jobId/logs       → listByJob()       — logs de um job específico
 *
 * Filtros em GET /logs:
 *   user_id, action, entity_type, job_id,
 *   date_from (YYYY-MM-DD), date_to (YYYY-MM-DD),
 *   search (user_name, action, details),
 *   page (default 1), limit (default 50, máx 200)
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function getPagination(query) {
  const page  = Math.max(1, Number(query.page)  || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

// Ações que representam importação de qualquer dado em um job
const IMPORT_ACTIONS = [
  'ADM_PONTO_IMPORTED',
  'FTX_PONTO_IMPORTED',
  'IPI_PONTO_IMPORTED',
  'IR_CSLL_PONTO_IMPORTED',
  'INSS_PONTO_IMPORTED',
  'PERDCOMP_IMPORTED',
  'DARF_IMPORTED',
  'M400_IMPORTED',
  'M610_IMPORTED',
];

/**
 * GET /logs
 */
async function list(req, res, next) {
  try {
    const {
      user_id, action, entity_type, job_id,
      date_from, date_to, search,
    } = req.query;

    const { page, limit, offset } = getPagination(req.query);

    const where  = [];
    const params = [];

    if (user_id)     { where.push('l.user_id = ?');     params.push(Number(user_id)); }
    if (action)      { where.push('l.action = ?');       params.push(action); }
    if (entity_type) { where.push('l.entity_type = ?');  params.push(entity_type); }
    if (job_id)      { where.push('l.job_id = ?');       params.push(Number(job_id)); }
    if (date_from)   { where.push('l.created_at >= ?');  params.push(`${date_from} 00:00:00`); }
    if (date_to)     { where.push('l.created_at <= ?');  params.push(`${date_to} 23:59:59`); }
    if (search) {
      where.push('(l.user_name LIKE ? OR l.action LIKE ? OR l.details LIKE ?)');
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM audit_logs l ${whereSql}`,
      params
    );

    const [rows] = await pool.query(
      `SELECT
         l.id,
         l.user_id,
         COALESCE(l.user_name, u.name) AS user_name,
         u.email                        AS user_email,
         l.action,
         l.entity_type,
         l.entity_id,
         l.job_id,
         j.job_number,
         l.details,
         l.ip_address,
         l.created_at
       FROM audit_logs l
       LEFT JOIN users u ON u.id = l.user_id
       LEFT JOIN jobs  j ON j.id = l.job_id
       ${whereSql}
       ORDER BY l.created_at DESC, l.id DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const data = rows.map((r) => ({
      ...r,
      details: r.details
        ? (typeof r.details === 'string' ? JSON.parse(r.details) : r.details)
        : null,
    }));

    res.json({ data, total, page, limit });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /jobs/:jobId/logs
 */
async function listByJob(req, res, next) {
  try {
    const { jobId } = req.params;
    const [jobRows] = await pool.query(`SELECT id FROM jobs WHERE id = ?`, [jobId]);
    if (!jobRows[0]) throw new ApiError(404, 'Job não encontrado.');

    req.query.job_id = jobId;
    return list(req, res, next);
  } catch (err) {
    next(err);
  }
}

/**
 * GET /logs/actions
 */
async function listActions(req, res, next) {
  try {
    const [rows] = await pool.query(
      `SELECT DISTINCT action FROM audit_logs ORDER BY action ASC`
    );
    res.json({ data: rows.map((r) => r.action) });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /logs/productivity
 *
 * Retorna métricas temporais por job para análise de produtividade.
 * Cada linha representa um job com os timestamps de cada marco do fluxo:
 *
 *   job_created_at     → first_import_at       (quanto tempo até começar a importar)
 *   first_import_at    → last_import_at        (duração da fase de importação)
 *   last_import_at     → first_obs_at          (quanto tempo até a 1ª observação)
 *   first_obs_at       → last_obs_at           (duração da fase de observações)
 *   last_obs_at        → first_status_change_at (quanto tempo até o envio p/ revisão)
 *   all_approved_at    → first_output_at       (quanto tempo da aprovação ao PPT/Parecer)
 *   needs_review_count / total_review_actions  (taxa de devolução)
 *
 * Filtros: date_from, date_to (sobre jobs.created_at)
 */
async function getProductivity(req, res, next) {
  try {
    const { date_from, date_to } = req.query;

    const dateWhere  = [];
    const dateParams = [];
    if (date_from) { dateWhere.push('j.created_at >= ?'); dateParams.push(`${date_from} 00:00:00`); }
    if (date_to)   { dateWhere.push('j.created_at <= ?'); dateParams.push(`${date_to} 23:59:59`); }
    const extraWhere = dateWhere.length ? `AND ${dateWhere.join(' AND ')}` : '';

    // Usa subqueries correlacionadas: evita GROUP BY com muitos JOINs, mais legível.
    // IMPORT_ACTIONS são constantes seguras (não vêm do usuário).
    const importIn = IMPORT_ACTIONS.map((a) => `'${a}'`).join(',');

    const [rows] = await pool.query(
      `SELECT
         j.id                AS job_id,
         j.job_number,
         c.company_name,
         j.created_at        AS job_created_at,

         /* Analista que criou o job */
         (SELECT l.user_name FROM audit_logs l
          WHERE l.job_id = j.id AND l.action = 'JOB_CREATED'
          ORDER BY l.created_at ASC LIMIT 1
         ) AS created_by,

         /* Marco 1: 1º import de qualquer dado */
         (SELECT MIN(l.created_at) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action IN (${importIn})
         ) AS first_import_at,

         /* Marco 2: Último import */
         (SELECT MAX(l.created_at) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action IN (${importIn})
         ) AS last_import_at,

         /* Marco 3: 1ª observação escrita */
         (SELECT MIN(l.created_at) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action = 'JOB_POINT_NOTE_UPDATED'
         ) AS first_obs_at,

         /* Marco 4: Última observação */
         (SELECT MAX(l.created_at) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action = 'JOB_POINT_NOTE_UPDATED'
         ) AS last_obs_at,

         /* Marco 5: 1ª mudança de status (proxy para "envio p/ revisão") */
         (SELECT MIN(l.created_at) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action = 'JOB_STATUS_CHANGED'
         ) AS first_status_change_at,

         /* Marco 6: Todos os pontos aprovados */
         (SELECT MIN(l.created_at) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action = 'ALL_POINTS_APPROVED'
         ) AS all_approved_at,

         /* Marco 7: 1ª emissão de saída (PPT ou Parecer) */
         (SELECT MIN(l.created_at) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action IN ('RESULTADO_PPT_GENERATED','PARECER_GERADO')
         ) AS first_output_at,

         /* Qualidade da revisão: quantas devoluções */
         (SELECT COUNT(*) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action = 'JOB_POINT_NEEDS_REVIEW'
         ) AS needs_review_count,

         (SELECT COUNT(*) FROM audit_logs l
          WHERE l.job_id = j.id AND l.action IN ('JOB_POINT_APPROVED','JOB_POINT_NEEDS_REVIEW')
         ) AS total_review_actions

       FROM jobs j
       LEFT JOIN clients c ON c.id = j.client_id
       WHERE 1=1 ${extraWhere}
       ORDER BY j.created_at DESC
       LIMIT 200`,
      dateParams
    );

    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, listByJob, listActions, getProductivity };