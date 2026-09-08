const { pool } = require('../config/database');

/* =====================================================================
 * perdcomp.controller.js — CRUD, importação em lote e desimportação (clear)
 * de PER/DCOMP.
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const STATUS_VALUES = ['EM_ANALISE', 'HOMOLOGADA', 'NAO_HOMOLOGADA', 'CANCELADA', 'RETIFICADA'];

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

async function list(req, res, next) {
  try {
    const { jobId } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM job_perdcomps WHERE job_id = ? ORDER BY transmission_date DESC, id DESC`,
      [jobId]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function bulkImport(req, res, next) {
  try {
    const { jobId } = req.params;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhuma linha para importar.');

    const [jobRows] = await pool.query(`SELECT id FROM jobs WHERE id = ?`, [jobId]);
    if (!jobRows[0]) throw new ApiError(404, 'Job não encontrado.');

    const conn = await pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        if (!row.perdcomp_number) continue;
        const status = STATUS_VALUES.includes(row.status) ? row.status : 'EM_ANALISE';
        await conn.query(
          `INSERT INTO job_perdcomps (job_id, perdcomp_number, transmission_date, credit_type, document_type, status)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             job_id = VALUES(job_id),
             transmission_date = VALUES(transmission_date),
             credit_type = VALUES(credit_type),
             document_type = VALUES(document_type),
             status = VALUES(status)`,
          [jobId, row.perdcomp_number, row.transmission_date || null, row.credit_type || null, row.document_type || null, status]
        );
        inserted += 1;
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAction(req, {
      action: 'PERDCOMP_IMPORTED', entityType: 'job_perdcomp', jobId: Number(jobId),
      details: { inserted, total_rows: rows.length },
    });

    res.json({ data: { inserted } });
  } catch (err) {
    next(err);
  }
}

async function remove(req, res, next) {
  try {
    const { jobId, id } = req.params;
    await pool.query(`DELETE FROM job_perdcomps WHERE job_id = ? AND id = ?`, [jobId, id]);

    await logAction(req, {
      action: 'PERDCOMP_DELETED', entityType: 'job_perdcomp', entityId: Number(id), jobId: Number(jobId),
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

// Zera toda a importação de PER/DCOMP de um job. Os registros individuais
// não voltam — só reimportando a planilha novamente — mas a ação fica
// registrada no audit_logs com a contagem do que foi removido.
async function clearAll(req, res, next) {
  try {
    const { jobId } = req.params;

    const [jobRows] = await pool.query(`SELECT id FROM jobs WHERE id = ?`, [jobId]);
    if (!jobRows[0]) throw new ApiError(404, 'Job não encontrado.');

    const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM job_perdcomps WHERE job_id = ?`, [jobId]);
    await pool.query(`DELETE FROM job_perdcomps WHERE job_id = ?`, [jobId]);

    await logAction(req, {
      action: 'PERDCOMP_CLEARED', entityType: 'job_perdcomp', jobId: Number(jobId),
      details: { deleted: count },
    });

    res.json({ data: { deleted: count } });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, bulkImport, remove, clearAll };