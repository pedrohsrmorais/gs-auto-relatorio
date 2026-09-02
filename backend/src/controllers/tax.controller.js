const { pool } = require('../config/database');
const asyncHandler = require('../utils/asyncHandler');
const ApiError = require('../utils/ApiError');
const { sendSuccess } = require('../utils/ApiResponse');

// Tabela de referência praticamente estática (PIS/COFINS, IRPJ/CSLL,
// INSS, IPI) — populada via seed no schema.sql. Exposta como somente
// leitura na maioria das rotas; update fica reservado ao admin.

// GET /api/taxes
exports.list = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM taxes ORDER BY id');
  sendSuccess(res, rows);
});

// GET /api/taxes/:id
exports.getById = asyncHandler(async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM taxes WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Tributo não encontrado.');
  sendSuccess(res, rows[0]);
});

// PUT /api/taxes/:id  (admin — apenas renomear/ajustar o código de exibição)
exports.update = asyncHandler(async (req, res) => {
  const { name } = req.body;
  if (!name) throw new ApiError(400, 'name é obrigatório.');

  const [rows] = await pool.query('SELECT id FROM taxes WHERE id = ?', [req.params.id]);
  if (!rows.length) throw new ApiError(404, 'Tributo não encontrado.');

  await pool.query('UPDATE taxes SET name = ? WHERE id = ?', [name, req.params.id]);
  const [updated] = await pool.query('SELECT * FROM taxes WHERE id = ?', [req.params.id]);
  sendSuccess(res, updated[0]);
});
