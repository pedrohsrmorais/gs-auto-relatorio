const { pool } = require('../config/database');

/* =====================================================================
 * logs.controller.js — consulta ao histórico de auditoria (admin-only).
 * Não grava logs (isso é feito localmente em cada controller de escrita);
 * este arquivo só expõe leitura/filtro sobre audit_logs.
 * ===================================================================== */

function getPagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 50));
  return { page, limit, offset: (page - 1) * limit };
}

async function list(req, res, next) {
  try {
    const { user_id, action, entity_type, job_id, date_from, date_to } = req.query;
    const { page, limit, offset } = getPagination(req.query);

    const where = [];
    const params = [];
    if (user_id) { where.push(`al.user_id = ?`); params.push(user_id); }
    if (action) { where.push(`al.action = ?`); params.push(action); }
    if (entity_type) { where.push(`al.entity_type = ?`); params.push(entity_type); }
    if (job_id) { where.push(`al.job_id = ?`); params.push(job_id); }
    if (date_from) { where.push(`al.created_at >= ?`); params.push(date_from); }
    if (date_to) { where.push(`al.created_at <= ?`); params.push(date_to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs al ${whereSql}`, params);
    const [rows] = await pool.query(
      `SELECT al.*, u.name AS user_name, u.email AS user_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       ${whereSql}
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    res.json({ data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function listByJob(req, res, next) {
  try {
    const { jobId } = req.params;
    const { page, limit, offset } = getPagination(req.query);

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM audit_logs WHERE job_id = ?`, [jobId]);
    const [rows] = await pool.query(
      `SELECT al.*, u.name AS user_name, u.email AS user_email
       FROM audit_logs al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE al.job_id = ?
       ORDER BY al.created_at DESC
       LIMIT ? OFFSET ?`,
      [jobId, limit, offset]
    );

    res.json({ data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, listByJob };