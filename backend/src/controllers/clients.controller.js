const { pool } = require('../config/database');

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

function getPagination(query) {
  const page = Math.max(1, Number(query.page) || 1);
  const limit = Math.min(200, Math.max(1, Number(query.limit) || 20));
  return { page, limit, offset: (page - 1) * limit };
}

// ─── Clientes ───────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const { search } = req.query;
    const { page, limit, offset } = getPagination(req.query);
    const where = search ? `WHERE company_name LIKE ? OR cnpj LIKE ?` : '';
    const params = search ? [`%${search}%`, `%${search}%`] : [];

    const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM clients ${where}`, params);
    const [rows] = await pool.query(
      `SELECT * FROM clients ${where} ORDER BY company_name ASC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    res.json({ data: rows, total, page, limit });
  } catch (err) {
    next(err);
  }
}

async function create(req, res, next) {
  try {
    const { cnpj, company_name, segment, tax_regime } = req.body;
    if (!cnpj || !company_name) throw new ApiError(400, 'CNPJ e razão social são obrigatórios.');
    const digitsOnly = String(cnpj).replace(/\D/g, '');
    if (digitsOnly.length !== 14) throw new ApiError(400, 'CNPJ deve conter 14 dígitos.');

    let result;
    try {
      [result] = await pool.query(
        `INSERT INTO clients (cnpj, company_name, segment, tax_regime) VALUES (?, ?, ?, ?)`,
        [digitsOnly, company_name, segment || null, tax_regime || null]
      );
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') throw new ApiError(409, 'Já existe um cliente com esse CNPJ.');
      throw err;
    }

    const [rows] = await pool.query(`SELECT * FROM clients WHERE id = ?`, [result.insertId]);

    await logAction(req, {
      action: 'CLIENT_CREATED', entityType: 'client', entityId: result.insertId,
      details: { company_name, cnpj: digitsOnly },
    });

    res.status(201).json({ data: rows[0] });
  } catch (err) {
    next(err);
  }
}

module.exports = { list, create };