const { pool } = require('../config/database');

/* =====================================================================
 * job.controller.js — jobs, equipe do job e diagnóstico (1:1).
 * (Clientes agora vivem em clients.controller.js)
 * (Diagnóstico de créditos PIS/COFINS agora vive em diagnostics.controller.js)
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const TEAM_ROLES = [
  'responsavel_tecnico', 'gerente_tributario', 'coordenador_tributario', 'analista_fiscal',
  'gerente_previdenciario', 'coordenador_previdenciario', 'analista_previdenciario',
];

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

function getPagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const { search, status, client_id } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    const where = [];
    const params = [];
    if (search) { where.push(`(j.job_number LIKE ? OR c.company_name LIKE ?)`); params.push(`%${search}%`, `%${search}%`); }
    if (status) { where.push(`j.status = ?`); params.push(status); }
    if (client_id) { where.push(`j.client_id = ?`); params.push(client_id); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) AS total FROM jobs j JOIN clients c ON c.id = j.client_id ${whereSql}`,
      params
    );
    const [rows] = await pool.query(
      `SELECT j.*, c.company_name, c.cnpj, c.segment AS client_segment
       FROM jobs j JOIN clients c ON c.id = j.client_id
       ${whereSql}
       ORDER BY j.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function get(req, res, next) {
  try {
    const { id } = req.params;

    const [jobRows] = await pool.query(
      `SELECT j.*, c.company_name, c.cnpj, c.segment AS client_segment
       FROM jobs j JOIN clients c ON c.id = j.client_id
       WHERE j.id = ? LIMIT 1`,
      [id]
    );
    const job = jobRows[0];
    if (!job) throw new ApiError(404, 'Job não encontrado.');

    const [team] = await pool.query(
      `SELECT jtm.id, jtm.role_in_job, u.id AS user_id, u.name
       FROM job_team_members jtm JOIN users u ON u.id = jtm.user_id
       WHERE jtm.job_id = ?
       ORDER BY FIELD(jtm.role_in_job, ${TEAM_ROLES.map(() => '?').join(',')})`,
      [id, ...TEAM_ROLES]
    );

    res.json({ data: { ...job, team } });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { job_number, client_id, period_start, period_end, tax_regime, segment } = req.body;
    if (!job_number || !client_id || !period_start || !period_end) {
      throw new ApiError(400, 'Número do job, cliente e período são obrigatórios.');
    }
    if (new Date(period_start) > new Date(period_end)) {
      throw new ApiError(400, 'O período inicial não pode ser posterior ao período final.');
    }

    let result;
    try {
      [result] = await pool.query(
        `INSERT INTO jobs (job_number, client_id, period_start, period_end, tax_regime, segment, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [job_number, client_id, period_start, period_end, tax_regime || null, segment || null, req.user.id]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'Já existe um job com esse número.');
      if (err.code === 'ER_NO_REFERENCED_ROW_2') throw new ApiError(400, 'Cliente informado não existe.');
      throw err;
    }

    const [rows] = await pool.query(`SELECT * FROM jobs WHERE id = ?`, [result.insertId]);

    await logAction(req, {
      action: 'JOB_CREATED', entityType: 'job', entityId: result.insertId, jobId: result.insertId,
      details: { job_number, client_id, period_start, period_end },
    });

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

async function updateStatus(req, res, next) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const VALID = ['diagnostico', 'em_analise', 'revisao', 'parecer_emitido', 'concluido', 'cancelado'];
    if (!VALID.includes(status)) throw new ApiError(400, 'Status inválido.');

    const [before] = await pool.query(`SELECT status FROM jobs WHERE id = ?`, [id]);
    if (!before[0]) throw new ApiError(404, 'Job não encontrado.');

    await pool.query(`UPDATE jobs SET status = ? WHERE id = ?`, [status, id]);
    const [rows] = await pool.query(`SELECT * FROM jobs WHERE id = ?`, [id]);

    await logAction(req, {
      action: 'JOB_STATUS_CHANGED', entityType: 'job', entityId: Number(id), jobId: Number(id),
      details: { from: before[0].status, to: status },
    });

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

// ─── Equipe do job (um usuário por papel por job) ──────────────────────────

async function setTeamMember(req, res, next) {
  try {
    const { jobId } = req.params;
    const { role_in_job, user_id } = req.body;
    if (!TEAM_ROLES.includes(role_in_job) || !user_id) {
      throw new ApiError(400, 'Papel e usuário são obrigatórios.');
    }

    const [jobRows] = await pool.query(`SELECT id FROM jobs WHERE id = ?`, [jobId]);
    if (!jobRows[0]) throw new ApiError(404, 'Job não encontrado.');

    await pool.query(
      `INSERT INTO job_team_members (job_id, role_in_job, user_id)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)`,
      [jobId, role_in_job, user_id]
    );

    await logAction(req, {
      action: 'JOB_TEAM_MEMBER_SET', entityType: 'job_team_member', jobId: Number(jobId),
      details: { role_in_job, user_id },
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function removeTeamMember(req, res, next) {
  try {
    const { jobId, memberId } = req.params;
    await pool.query(`DELETE FROM job_team_members WHERE job_id = ? AND id = ?`, [jobId, memberId]);

    await logAction(req, {
      action: 'JOB_TEAM_MEMBER_REMOVED', entityType: 'job_team_member', entityId: Number(memberId), jobId: Number(jobId),
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// ─── Detalhes gerais do job ─────────────────────────────────────────────────

async function updateDetails(req, res, next) {
  try {
    const { id } = req.params;
    const { tax_regime, segment } = req.body;
    const VALID_REGIMES = ['Lucro Real', 'Lucro Presumido', 'Simples Nacional', 'Lucro Arbitrado'];
    if (tax_regime !== undefined && tax_regime !== null && !VALID_REGIMES.includes(tax_regime)) {
      throw new ApiError(400, 'Regime tributário inválido.');
    }

    const fields = [];
    const params = [];
    if (tax_regime !== undefined) { fields.push('tax_regime = ?'); params.push(tax_regime || null); }
    if (segment !== undefined) { fields.push('segment = ?'); params.push(segment || null); }
    if (fields.length === 0) throw new ApiError(400, 'Nenhum campo para atualizar.');

    const [before] = await pool.query(`SELECT tax_regime, segment FROM jobs WHERE id = ?`, [id]);
    if (!before[0]) throw new ApiError(404, 'Job não encontrado.');

    params.push(id);
    await pool.query(`UPDATE jobs SET ${fields.join(', ')} WHERE id = ?`, params);
    const [rows] = await pool.query(`SELECT * FROM jobs WHERE id = ?`, [id]);

    await logAction(req, {
      action: 'JOB_DETAILS_UPDATED', entityType: 'job', entityId: Number(id), jobId: Number(id),
      details: { before: before[0], after: { tax_regime, segment } },
    });

    res.json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}


// adicionar no fim, antes do module.exports

async function remove(req, res, next) {
  try {
    const { id } = req.params;
    const [rows] = await pool.query(`SELECT id, job_number FROM jobs WHERE id = ?`, [id]);
    if (!rows[0]) throw new ApiError(404, 'Job não encontrado.');

    // Loga ANTES de apagar, com jobId: null — se logasse depois referenciando
    // o job_id, e audit_logs.job_id tiver ON DELETE CASCADE, o próprio
    // registro de auditoria da exclusão sumiria junto com o job.
    await logAction(req, {
      action: 'JOB_DELETED', entityType: 'job', entityId: Number(id), jobId: null,
      details: { job_number: rows[0].job_number },
    });

    // ON DELETE CASCADE cuida de perdcomps, darf, sped m400/m610,
    // pontos_adm/ftx, job_point_notes, job_team_members e job_reports.
    await pool.query(`DELETE FROM jobs WHERE id = ?`, [id]);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = {
  list, get, create, updateStatus, updateDetails,
  setTeamMember, removeTeamMember, remove,
};