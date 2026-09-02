const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/paginate');
const mergeUpdate = require('../utils/mergeUpdate');

const TAX_REGIMES = ['Lucro Real', 'Lucro Presumido', 'Simples Nacional', 'Lucro Arbitrado'];

function normalizeCnpj(cnpj) {
  return String(cnpj || '').replace(/\D/g, '');
}

// GET /api/clients
exports.list = asyncHandler(async (req, res) => {
  const { search, tax_regime } = req.query;
  const { page, limit, offset } = getPagination(req.query);

  const conditions = [];
  const params = [];

  if (search) {
    conditions.push('(company_name LIKE ? OR cnpj LIKE ?)');
    params.push(`%${search}%`, `%${normalizeCnpj(search) || search}%`);
  }
  if (tax_regime) { conditions.push('tax_regime = ?'); params.push(tax_regime); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT * FROM clients ${where} ORDER BY company_name LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(`SELECT COUNT(*) AS total FROM clients ${where}`, params);

  sendSuccess(res, rows, { meta: buildMeta({ page, limit, total }) });
});

// GET /api/clients/:id
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Cliente não encontrado.');
  sendSuccess(res, rows[0]);
});

// GET /api/clients/:id/jobs  (atalho: histórico de jobs do cliente)
exports.listJobs = asyncHandler(async (req, res) => {
  const [client] = await pool.query('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!client.length) throw new ApiError(404, 'Cliente não encontrado.');

  const [rows] = await pool.query(
    'SELECT * FROM jobs WHERE client_id = ? ORDER BY period_start DESC',
    [req.params.id]
  );
  sendSuccess(res, rows);
});

// POST /api/clients
exports.create = asyncHandler(async (req, res) => {
  const { cnpj, company_name, segment = null, tax_regime = null } = req.body;

  const cleanCnpj = normalizeCnpj(cnpj);
  if (cleanCnpj.length !== 14) throw new ApiError(400, 'cnpj deve conter 14 dígitos.');
  if (!company_name) throw new ApiError(400, 'company_name é obrigatório.');
  if (tax_regime && !TAX_REGIMES.includes(tax_regime)) {
    throw new ApiError(400, `tax_regime deve ser um de: ${TAX_REGIMES.join(', ')}.`);
  }

  const [existing] = await pool.query('SELECT id FROM clients WHERE cnpj = ?', [cleanCnpj]);
  if (existing.length) throw new ApiError(409, 'Já existe um cliente com este CNPJ.');

  const [result] = await pool.query(
    'INSERT INTO clients (cnpj, company_name, segment, tax_regime) VALUES (?, ?, ?, ?)',
    [cleanCnpj, company_name, segment, tax_regime]
  );

  const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [result.insertId]);
  sendCreated(res, rows[0]);
});

// PUT /api/clients/:id
exports.update = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Cliente não encontrado.');

  const data = mergeUpdate(rows[0], req.body, ['company_name', 'segment', 'tax_regime']);
  if (data.tax_regime && !TAX_REGIMES.includes(data.tax_regime)) {
    throw new ApiError(400, `tax_regime deve ser um de: ${TAX_REGIMES.join(', ')}.`);
  }

  await pool.query(
    'UPDATE clients SET company_name = ?, segment = ?, tax_regime = ? WHERE id = ?',
    [data.company_name, data.segment, data.tax_regime, req.params.id]
  );

  const [updated] = await pool.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});

// DELETE /api/clients/:id
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id FROM clients WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Cliente não encontrado.');

  const [jobs] = await pool.query('SELECT id FROM jobs WHERE client_id = ? LIMIT 1', [req.params.id]);
  if (jobs.length) {
    throw new ApiError(409, 'Não é possível excluir um cliente com Jobs vinculados.');
  }

  await pool.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
  sendSuccess(res, null, { message: 'Cliente removido.' });
});
