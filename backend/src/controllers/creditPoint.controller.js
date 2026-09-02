const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess, sendCreated } = require('../utils/ApiResponse');
const { getPagination, buildMeta } = require('../utils/paginate');
const mergeUpdate = require('../utils/mergeUpdate');

const CATEGORIES = ['ADM', 'FINTAX'];
const RISK_COLORS = ['VERDE', 'AMARELO', 'VERMELHO'];

// Catálogo mestre dos ~150 "pontos de crédito" mapeados nas abas INICIO /
// Tabela ADM / Tabelas FINTAX / Resumo IR / Resumo PIS e COFINS / Resumo
// de Créditos INSS. Cada Job referencia estes pontos em
// job_credit_point_analyses — nunca duplica o texto do ponto por Job.

// GET /api/credit-points
exports.list = asyncHandler(async (req, res) => {
  const { tax_id, category, risk_color, is_active, search } = req.query;
  const { page, limit, offset } = getPagination(req.query, { defaultLimit: 50, maxLimit: 200 });

  const conditions = [];
  const params = [];

  if (tax_id) { conditions.push('cp.tax_id = ?'); params.push(tax_id); }
  if (category) { conditions.push('cp.category = ?'); params.push(category); }
  if (risk_color) { conditions.push('cp.risk_color = ?'); params.push(risk_color); }
  if (is_active !== undefined) { conditions.push('cp.is_active = ?'); params.push(is_active === 'true' ? 1 : 0); }
  if (search) { conditions.push('cp.name LIKE ?'); params.push(`%${search}%`); }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await pool.query(
    `SELECT cp.*, t.code AS tax_code, t.name AS tax_name
     FROM credit_points cp JOIN taxes t ON t.id = cp.tax_id
     ${where}
     ORDER BY t.id, cp.name
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );
  const [[{ total }]] = await pool.query(
    `SELECT COUNT(*) AS total FROM credit_points cp ${where}`, params
  );

  sendSuccess(res, rows, { meta: buildMeta({ page, limit, total }) });
});

// GET /api/credit-points/:id
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query(
    `SELECT cp.*, t.code AS tax_code, t.name AS tax_name
     FROM credit_points cp JOIN taxes t ON t.id = cp.tax_id
     WHERE cp.id = ?`,
    [req.params.id]
  );
  if (!rows.length) throw new ApiError(404, 'Ponto de crédito não encontrado.');
  sendSuccess(res, rows[0]);
});

// POST /api/credit-points
exports.create = asyncHandler(async (req, res) => {
  const { tax_id, name, category = 'ADM', risk_color = null, legal_criteria = null } = req.body;

  if (!tax_id || !name) throw new ApiError(400, 'tax_id e name são obrigatórios.');
  if (!CATEGORIES.includes(category)) throw new ApiError(400, `category deve ser um de: ${CATEGORIES.join(', ')}.`);
  if (risk_color && !RISK_COLORS.includes(risk_color)) {
    throw new ApiError(400, `risk_color deve ser um de: ${RISK_COLORS.join(', ')}.`);
  }
  if (category === 'ADM' && risk_color) {
    throw new ApiError(400, 'risk_color só se aplica a pontos da categoria FINTAX.');
  }

  const [tax] = await pool.query('SELECT id FROM taxes WHERE id = ?', [tax_id]);
  if (!tax.length) throw new ApiError(404, 'Tributo informado não existe.');

  const [existing] = await pool.query(
    'SELECT id FROM credit_points WHERE tax_id = ? AND name = ?', [tax_id, name]
  );
  if (existing.length) throw new ApiError(409, 'Já existe um ponto com este nome para este tributo.');

  const [result] = await pool.query(
    `INSERT INTO credit_points (tax_id, name, category, risk_color, legal_criteria)
     VALUES (?, ?, ?, ?, ?)`,
    [tax_id, name, category, risk_color, legal_criteria]
  );

  const [rows] = await pool.query('SELECT * FROM credit_points WHERE id = ?', [result.insertId]);
  sendCreated(res, rows[0]);
});

// PUT /api/credit-points/:id
exports.update = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM credit_points WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Ponto de crédito não encontrado.');

  const data = mergeUpdate(rows[0], req.body, [
    'name', 'category', 'risk_color', 'legal_criteria', 'is_active',
  ]);
  if (!CATEGORIES.includes(data.category)) throw new ApiError(400, `category deve ser um de: ${CATEGORIES.join(', ')}.`);
  if (data.risk_color && !RISK_COLORS.includes(data.risk_color)) {
    throw new ApiError(400, `risk_color deve ser um de: ${RISK_COLORS.join(', ')}.`);
  }

  await pool.query(
    `UPDATE credit_points SET name = ?, category = ?, risk_color = ?, legal_criteria = ?, is_active = ?
     WHERE id = ?`,
    [data.name, data.category, data.risk_color, data.legal_criteria, !!data.is_active, req.params.id]
  );

  const [updated] = await pool.query('SELECT * FROM credit_points WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});

// DELETE /api/credit-points/:id  (soft delete — histórico de análises depende deste registro)
exports.remove = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT id FROM credit_points WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Ponto de crédito não encontrado.');

  await pool.query('UPDATE credit_points SET is_active = FALSE WHERE id = ?', [req.params.id]);
  sendSuccess(res, null, { message: 'Ponto de crédito desativado.' });
});
