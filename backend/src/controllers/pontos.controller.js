const { pool } = require('../config/database');

/* =====================================================================
 * pontos.controller.js
 *
 * Cobre três responsabilidades:
 *   1. Valores mensais por ponto ADM  (tabela pontos_adm)
 *   2. Valores mensais por ponto FTX  (tabela pontos_ftx)
 *   3. Comparativo por categoria – Relatório 2  (pontos_ftx_categoria)
 *   4. Gerenciamento de credit_point_definitions (listagem + renomeação)
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

// ─── Auditoria ───────────────────────────────────────────────────────────────

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function assertJobExists(jobId) {
  const [rows] = await pool.query(`SELECT id FROM jobs WHERE id = ?`, [jobId]);
  if (!rows[0]) throw new ApiError(404, 'Job não encontrado.');
}

function num(v) {
  return v === undefined || v === null || v === '' ? 0 : Number(v);
}

// Garante que existe uma definição de ponto (category + external_id); cria se necessário.
// Só sobrescreve o nome existente se vier um nome novo e diferente na planilha.
async function resolvePointDefinition(conn, category, externalId, name) {
  const [existing] = await conn.query(
    `SELECT id, name FROM credit_point_definitions WHERE category = ? AND external_id = ? LIMIT 1`,
    [category, externalId]
  );

  if (existing[0]) {
    if (name && name.trim() && name.trim() !== existing[0].name) {
      await conn.query(
        `UPDATE credit_point_definitions SET name = ? WHERE id = ?`,
        [name.trim(), existing[0].id]
      );
      return { id: existing[0].id, name: name.trim() };
    }
    return { id: existing[0].id, name: existing[0].name };
  }

  // Cria novo — se não vier nome da planilha deixa em branco para o usuário preencher
  const finalName = (name && name.trim()) || '';
  const [result] = await conn.query(
    `INSERT INTO credit_point_definitions (category, external_id, name) VALUES (?, ?, ?)`,
    [category, externalId, finalName]
  );
  return { id: result.insertId, name: finalName };
}

// ─── Fábricas genéricas (ADM e FTX compartilham a mesma lógica) ──────────────

function listPontos(tableName) {
  return async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const [rows] = await pool.query(
        `SELECT p.*, d.external_id, d.name AS point_name
         FROM ${tableName} p
         JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
         WHERE p.job_id = ?
         ORDER BY d.name ASC, p.reference_month ASC, p.contribution ASC`,
        [jobId]
      );
      res.json({ data: rows });
    } catch (err) {
      next(err);
    }
  };
}

function bulkImportPontos(category, tableName) {
  return async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const { rows } = req.body;
      if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhum valor para importar.');
      await assertJobExists(jobId);

      const externalPointId = rows[0]?.external_point_id;
      if (!externalPointId) throw new ApiError(400, 'ID_PONTO não identificado nos dados enviados.');

      const conn = await pool.getConnection();
      let inserted = 0;
      let pointName = '';
      try {
        await conn.beginTransaction();

        const pointDefName = rows.find((r) => r.point_name)?.point_name ?? null;
        const point = await resolvePointDefinition(conn, category, externalPointId, pointDefName);
        pointName = point.name;

        for (const row of rows) {
          if (!row.reference_month || !['PIS', 'COFINS'].includes(row.contribution)) continue;
          await conn.query(
            `INSERT INTO ${tableName}
               (job_id, credit_point_definition_id, external_tax_id, reference_month, contribution, value)
             VALUES (?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               external_tax_id = VALUES(external_tax_id),
               value           = VALUES(value)`,
            [jobId, point.id, row.external_tax_id ?? null, row.reference_month, row.contribution, num(row.value)]
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
        action: `${category}_PONTO_IMPORTED`,
        entityType: tableName,
        jobId: Number(jobId),
        details: { external_point_id: externalPointId, point_name: pointName, inserted },
      });

      res.json({ data: { inserted, pointName } });
    } catch (err) {
      next(err);
    }
  };
}

function clearPontos(tableName, logPrefix) {
  return async (req, res, next) => {
    try {
      const { jobId } = req.params;
      await assertJobExists(jobId);

      const [[{ count }]] = await pool.query(
        `SELECT COUNT(*) AS count FROM ${tableName} WHERE job_id = ?`,
        [jobId]
      );
      await pool.query(`DELETE FROM ${tableName} WHERE job_id = ?`, [jobId]);

      await logAction(req, {
        action: `${logPrefix}_CLEARED`,
        entityType: tableName,
        jobId: Number(jobId),
        details: { deleted: count },
      });

      res.json({ data: { deleted: count } });
    } catch (err) {
      next(err);
    }
  };
}

// ─── Pontos ADM ───────────────────────────────────────────────────────────────
const listAdm       = listPontos('pontos_adm');
const bulkImportAdm = bulkImportPontos('ADM', 'pontos_adm');
const clearAdm      = clearPontos('pontos_adm', 'PONTOS_ADM');

// ─── Pontos FTX ───────────────────────────────────────────────────────────────
const listFtx       = listPontos('pontos_ftx');
const bulkImportFtx = bulkImportPontos('FTX', 'pontos_ftx');
const clearFtx      = clearPontos('pontos_ftx', 'PONTOS_FTX');

// ─── Comparativo por categoria (Relatório 2) ──────────────────────────────────

async function listFtxCategoria(req, res, next) {
  try {
    const { jobId } = req.params;
    const [rows] = await pool.query(
      `SELECT * FROM pontos_ftx_categoria
       WHERE job_id = ?
       ORDER BY reference_year DESC, risk_color, point_name`,
      [jobId]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function bulkImportFtxCategoria(req, res, next) {
  try {
    const { jobId } = req.params;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhuma linha para importar.');
    await assertJobExists(jobId);

    const VALID_COLORS = ['VERDE', 'AMARELO', 'VERMELHO'];
    const conn = await pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        if (!VALID_COLORS.includes(row.risk_color) || !row.tax_name || !row.point_name || !row.reference_year) continue;
        await conn.query(
          `INSERT INTO pontos_ftx_categoria (job_id, risk_color, tax_name, point_name, reference_year, value)
           VALUES (?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [jobId, row.risk_color, row.tax_name, row.point_name, row.reference_year, num(row.value)]
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
      action: 'FTX_CATEGORIA_IMPORTED',
      entityType: 'pontos_ftx_categoria',
      jobId: Number(jobId),
      details: { inserted, total_rows: rows.length },
    });

    res.json({ data: { inserted } });
  } catch (err) {
    next(err);
  }
}

async function clearFtxCategoria(req, res, next) {
  try {
    const { jobId } = req.params;
    await assertJobExists(jobId);

    const [[{ count }]] = await pool.query(
      `SELECT COUNT(*) AS count FROM pontos_ftx_categoria WHERE job_id = ?`,
      [jobId]
    );
    await pool.query(`DELETE FROM pontos_ftx_categoria WHERE job_id = ?`, [jobId]);

    await logAction(req, {
      action: 'FTX_CATEGORIA_CLEARED',
      entityType: 'pontos_ftx_categoria',
      jobId: Number(jobId),
      details: { deleted: count },
    });

    res.json({ data: { deleted: count } });
  } catch (err) {
    next(err);
  }
}

// ─── Credit point definitions (gerenciamento de nomes) ───────────────────────

/**
 * GET /credit-point-definitions?category=ADM&search=...
 * Lista todas as definições, com sem-nome ordenados primeiro.
 */
async function listDefinitions(req, res, next) {
  try {
    const { category, search } = req.query;

    let sql = `SELECT id, category, external_id, name, created_at, updated_at
               FROM credit_point_definitions
               WHERE 1=1`;
    const params = [];

    if (category) {
      sql += ` AND category = ?`;
      params.push(category);
    }

    if (search) {
      sql += ` AND (name LIKE ? OR external_id LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    // Sem-nome (string vazia) ficam no topo; depois alfabético; empate por external_id
    sql += ` ORDER BY category ASC,
                      COALESCE(NULLIF(TRIM(name), ''), '\xff') ASC,
                      external_id ASC`;

    const [rows] = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

/**
 * PATCH /credit-point-definitions/:id
 * Renomeia uma definição de ponto. Body: { name: string }
 */
async function updateDefinitionName(req, res, next) {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) throw new ApiError(400, 'O nome não pode estar vazio.');

    const [existing] = await pool.query(
      `SELECT id, category, external_id, name FROM credit_point_definitions WHERE id = ?`,
      [id]
    );
    if (!existing[0]) throw new ApiError(404, 'Definição de ponto não encontrada.');

    const newName = name.trim();
    await pool.query(`UPDATE credit_point_definitions SET name = ? WHERE id = ?`, [newName, id]);

    await logAction(req, {
      action: 'CREDIT_POINT_DEF_RENAMED',
      entityType: 'credit_point_definitions',
      entityId: Number(id),
      details: {
        old_name:    existing[0].name,
        new_name:    newName,
        category:    existing[0].category,
        external_id: existing[0].external_id,
      },
    });

    const [updated] = await pool.query(
      `SELECT id, category, external_id, name, updated_at FROM credit_point_definitions WHERE id = ?`,
      [id]
    );
    res.json({ data: updated[0] });
  } catch (err) {
    next(err);
  }
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  // Pontos ADM
  listAdm, bulkImportAdm, clearAdm,
  // Pontos FTX
  listFtx, bulkImportFtx, clearFtx,
  // Comparativo por categoria
  listFtxCategoria, bulkImportFtxCategoria, clearFtxCategoria,
  // Definições de pontos (nomeação)
  listDefinitions, updateDefinitionName,
};