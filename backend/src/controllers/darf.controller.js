const { pool } = require('../config/database');

/* =====================================================================
 * darf.controller.js — DARF + SPED M400 + SPED M610.
 * Inclui CRUD, importação em lote e desimportação (clear) de cada tabela.
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
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

function num(value) {
  return value === undefined || value === null || value === '' ? 0 : Number(value);
}

// ─── DARF ───────────────────────────────────────────────────────────────────

async function listDarf(req, res, next) {
  try {
    const { jobId } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM job_darf_entries WHERE job_id = ? ORDER BY due_date DESC, id DESC`,
      [jobId]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function bulkImportDarf(req, res, next) {
  try {
    const { jobId } = req.params;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhuma linha para importar.');
    await assertJobExists(jobId);

    const conn = await pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        await conn.query(
          `INSERT INTO job_darf_entries (
             job_id, data_base, darf_code, collection_date, due_date, assessment_period,
             revenue_code, name, document_number, total_value, days_late,
             principal_value, fine_value, interest_value, tax_group, cnpj
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            jobId, row.data_base || null, row.darf_code || null, row.collection_date || null,
            row.due_date || null, row.assessment_period || null, row.revenue_code || null,
            row.name || null, row.document_number || null, num(row.total_value),
            num(row.days_late), num(row.principal_value), num(row.fine_value),
            num(row.interest_value), row.tax_group || null, row.cnpj || null,
          ]
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
      action: 'DARF_IMPORTED', entityType: 'job_darf_entry', jobId: Number(jobId),
      details: { inserted, total_rows: rows.length },
    });

    res.json({ data: { inserted } });
  } catch (err) {
    next(err);
  }
}

async function removeDarf(req, res, next) {
  try {
    const { jobId, id } = req.params;
    await pool.query(`DELETE FROM job_darf_entries WHERE job_id = ? AND id = ?`, [jobId, id]);

    await logAction(req, {
      action: 'DARF_DELETED', entityType: 'job_darf_entry', entityId: Number(id), jobId: Number(jobId),
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function clearDarf(req, res, next) {
  try {
    const { jobId } = req.params;
    await assertJobExists(jobId);

    const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM job_darf_entries WHERE job_id = ?`, [jobId]);
    await pool.query(`DELETE FROM job_darf_entries WHERE job_id = ?`, [jobId]);

    await logAction(req, {
      action: 'DARF_CLEARED', entityType: 'job_darf_entry', jobId: Number(jobId),
      details: { deleted: count },
    });

    res.json({ data: { deleted: count } });
  } catch (err) {
    next(err);
  }
}

// ─── SPED M400 ──────────────────────────────────────────────────────────────

async function listM400(req, res, next) {
  try {
    const { jobId } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM job_sped_m400_entries WHERE job_id = ? ORDER BY reference_month DESC, id DESC`,
      [jobId]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function bulkImportM400(req, res, next) {
  try {
    const { jobId } = req.params;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhuma linha para importar.');
    await assertJobExists(jobId);

    const conn = await pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        if (!row.reference_month) continue;
        await conn.query(
          `INSERT INTO job_sped_m400_entries (
             job_id, reference_month, establishment, reg, cst, gross_revenue_value,
             accounting_account_code, revenue_description, bookkeeping_type
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            jobId, row.reference_month, row.establishment || null, row.reg || null, row.cst || null,
            num(row.gross_revenue_value), row.accounting_account_code || null,
            row.revenue_description || null, row.bookkeeping_type || null,
          ]
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
      action: 'SPED_M400_IMPORTED', entityType: 'job_sped_m400_entry', jobId: Number(jobId),
      details: { inserted, total_rows: rows.length },
    });

    res.json({ data: { inserted } });
  } catch (err) {
    next(err);
  }
}

async function removeM400(req, res, next) {
  try {
    const { jobId, id } = req.params;
    await pool.query(`DELETE FROM job_sped_m400_entries WHERE job_id = ? AND id = ?`, [jobId, id]);

    await logAction(req, {
      action: 'SPED_M400_DELETED', entityType: 'job_sped_m400_entry', entityId: Number(id), jobId: Number(jobId),
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function clearM400(req, res, next) {
  try {
    const { jobId } = req.params;
    await assertJobExists(jobId);

    const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM job_sped_m400_entries WHERE job_id = ?`, [jobId]);
    await pool.query(`DELETE FROM job_sped_m400_entries WHERE job_id = ?`, [jobId]);

    await logAction(req, {
      action: 'SPED_M400_CLEARED', entityType: 'job_sped_m400_entry', jobId: Number(jobId),
      details: { deleted: count },
    });

    res.json({ data: { deleted: count } });
  } catch (err) {
    next(err);
  }
}

// ─── SPED M610 ──────────────────────────────────────────────────────────────

async function listM610(req, res, next) {
  try {
    const { jobId } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM job_sped_m610_entries WHERE job_id = ? ORDER BY reference_month DESC, id DESC`,
      [jobId]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function bulkImportM610(req, res, next) {
  try {
    const { jobId } = req.params;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhuma linha para importar.');
    await assertJobExists(jobId);

    const conn = await pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        if (!row.reference_month) continue;
        await conn.query(
          `INSERT INTO job_sped_m610_entries (
             job_id, reference_month, establishment, contribution_code, contribution_description,
             gross_revenue_value, calculation_base_value, pis_aliquot, pis_quantity, pis_quantity_aliquot,
             total_contribution_calculated, addition_adjustments_value, reduction_adjustments_value,
             deferred_contribution_value, previous_deferred_contribution_value,
             total_period_contribution_value, bookkeeping_type
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            jobId, row.reference_month, row.establishment || null, row.contribution_code || null,
            row.contribution_description || null, num(row.gross_revenue_value), num(row.calculation_base_value),
            num(row.pis_aliquot), num(row.pis_quantity), num(row.pis_quantity_aliquot),
            num(row.total_contribution_calculated), num(row.addition_adjustments_value),
            num(row.reduction_adjustments_value), num(row.deferred_contribution_value),
            num(row.previous_deferred_contribution_value), num(row.total_period_contribution_value),
            row.bookkeeping_type || null,
          ]
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
      action: 'SPED_M610_IMPORTED', entityType: 'job_sped_m610_entry', jobId: Number(jobId),
      details: { inserted, total_rows: rows.length },
    });

    res.json({ data: { inserted } });
  } catch (err) {
    next(err);
  }
}

async function removeM610(req, res, next) {
  try {
    const { jobId, id } = req.params;
    await pool.query(`DELETE FROM job_sped_m610_entries WHERE job_id = ? AND id = ?`, [jobId, id]);

    await logAction(req, {
      action: 'SPED_M610_DELETED', entityType: 'job_sped_m610_entry', entityId: Number(id), jobId: Number(jobId),
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

async function clearM610(req, res, next) {
  try {
    const { jobId } = req.params;
    await assertJobExists(jobId);

    const [[{ count }]] = await pool.query(`SELECT COUNT(*) AS count FROM job_sped_m610_entries WHERE job_id = ?`, [jobId]);
    await pool.query(`DELETE FROM job_sped_m610_entries WHERE job_id = ?`, [jobId]);

    await logAction(req, {
      action: 'SPED_M610_CLEARED', entityType: 'job_sped_m610_entry', jobId: Number(jobId),
      details: { deleted: count },
    });

    res.json({ data: { deleted: count } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listDarf, bulkImportDarf, removeDarf, clearDarf,
  listM400, bulkImportM400, removeM400, clearM400,
  listM610, bulkImportM610, removeM610, clearM610,
};