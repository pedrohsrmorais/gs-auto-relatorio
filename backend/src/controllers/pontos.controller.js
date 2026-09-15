const { pool } = require('../config/database');

/* =====================================================================
 * pontos.controller.js
 *
 * Cobre:
 *   1. Valores mensais por ponto ADM  (tabela pontos_adm)      — PIS/COFINS
 *   2. Valores mensais por ponto FTX  (tabela pontos_ftx)      — PIS/COFINS
 *   3. Valores mensais por ponto IPI  (tabela pontos_ipi)      — sem split
 *   4. Valores anuais por ponto IR/CSLL (tabela pontos_ir_csll) — split IRPJ/CSLL
 *   5. Gerenciamento de credit_point_definitions (listagem, renomeação,
 *      cor de risco, tributo/natureza, importação em massa, criação manual
 *      e reset total).
 *
 * IMPORTANTE — IPI e IR/CSLL NÃO fazem mais "match por nome automático com
 * criação silenciosa" no backend. Esses formatos de planilha não trazem
 * ID_PONTO, só o nome, e o catálogo pode ter nomes repetidos (ex.: "PAT"
 * existe como ponto de crédito E como ponto passivo, com IDs diferentes) —
 * então casar só pelo texto do nome é arriscado. Agora o FRONTEND resolve
 * o match (mostrando ao usuário o ponto do catálogo que ele identificou,
 * com nome e ID, e permitindo busca manual quando não há match ou quando o
 * usuário quer trocar) e manda o `credit_point_definition_id` já
 * confirmado. O backend só grava valores no ID que recebeu.
 * ===================================================================== */

class ApiError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

const VALID_COLORS = ['VERDE', 'AMARELO', 'VERMELHO'];
const VALID_NATURES = ['CREDITO', 'PASSIVO'];

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

// Garante que existe uma definição de ponto (category + external_id); cria se
// necessário. Usado só por ADM/FTX (PIS/COFINS), que TÊM ID_PONTO na
// planilha de origem — diferente de IPI/IR-CSLL, ver nota no topo do arquivo.
async function resolvePointDefinition(conn, category, externalId, name, riskColor) {
  const [existing] = await conn.query(
    `SELECT id, name, risk_color FROM credit_point_definitions WHERE category = ? AND external_id = ? LIMIT 1`,
    [category, externalId]
  );

  if (existing[0]) {
    const updates = {};
    if (name && name.trim() && name.trim() !== existing[0].name) updates.name = name.trim();
    if (riskColor && VALID_COLORS.includes(riskColor) && riskColor !== existing[0].risk_color) {
      updates.risk_color = riskColor;
    }
    if (Object.keys(updates).length > 0) {
      const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
      await conn.query(
        `UPDATE credit_point_definitions SET ${setClauses} WHERE id = ?`,
        [...Object.values(updates), existing[0].id]
      );
    }
    return {
      id: existing[0].id,
      name: updates.name ?? existing[0].name,
      risk_color: updates.risk_color ?? existing[0].risk_color,
    };
  }

  const finalName = (name && name.trim()) || '';
  const finalColor = VALID_COLORS.includes(riskColor) ? riskColor : null;
  const [result] = await conn.query(
    `INSERT INTO credit_point_definitions (category, external_id, name, risk_color) VALUES (?, ?, ?, ?)`,
    [category, externalId, finalName, finalColor]
  );
  return { id: result.insertId, name: finalName, risk_color: finalColor };
}

// ─── Fábricas genéricas (ADM e FTX compartilham a mesma lógica) ──────────────

function listPontos(tableName) {
  return async (req, res, next) => {
    try {
      const { jobId } = req.params;
      const [rows] = await pool.query(
        `SELECT p.*, d.external_id, d.name AS point_name, d.risk_color, d.tax_id, t.code AS tax_code, t.name AS tax_name
         FROM ${tableName} p
         JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
         LEFT JOIN taxes t ON t.id = d.tax_id
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
      await assertJobExists(jobId);

      let groups = req.body.groups;
      if (!groups) {
        const { rows } = req.body;
        if (!Array.isArray(rows) || rows.length === 0)
          throw new ApiError(400, 'Nenhum valor para importar.');
        const externalPointId = rows[0]?.external_point_id;
        if (!externalPointId)
          throw new ApiError(400, 'ID_PONTO não identificado nos dados enviados.');
        groups = [{ external_point_id: externalPointId, rows }];
      }

      if (!Array.isArray(groups) || groups.length === 0)
        throw new ApiError(400, 'Nenhum grupo de pontos para importar.');

      const conn = await pool.getConnection();
      let totalInserted = 0;
      const pointsSummary = [];

      try {
        await conn.beginTransaction();

        for (const group of groups) {
          const { external_point_id: externalPointId, rows, point_name: groupPointName } = group;
          if (!externalPointId || !Array.isArray(rows) || rows.length === 0) continue;

          const pointDefName = groupPointName
            || rows.find((r) => r.point_name)?.point_name
            || null;

          const point = await resolvePointDefinition(conn, category, externalPointId, pointDefName, null);
          let groupInserted = 0;

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
            groupInserted += 1;
          }

          totalInserted += groupInserted;
          pointsSummary.push({ external_point_id: externalPointId, point_name: point.name, inserted: groupInserted });
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
        details: { points: pointsSummary, total_inserted: totalInserted },
      });

      const firstPoint = pointsSummary[0];
      res.json({
        data: {
          inserted: totalInserted,
          pointName: firstPoint?.point_name ?? '',
          points: pointsSummary,
        },
      });
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

// ─── Pontos ADM (PIS/COFINS) ────────────────────────────────────────────────
const listAdm       = listPontos('pontos_adm');
const bulkImportAdm = bulkImportPontos('ADM', 'pontos_adm');
const clearAdm      = clearPontos('pontos_adm', 'PONTOS_ADM');

// ─── Pontos FTX (PIS/COFINS) ─────────────────────────────────────────────────
const listFtx       = listPontos('pontos_ftx');
const bulkImportFtx = bulkImportPontos('FTX', 'pontos_ftx');
const clearFtx      = clearPontos('pontos_ftx', 'PONTOS_FTX');

// ═════════════════════════════════════════════════════════════════════════
// Pontos IPI — mensal, valor único (sem split PIS/COFINS)
//
// Body: { credit_point_definition_id: number, rows: [{ reference_month, value }] }
// O ponto já vem RESOLVIDO pelo frontend (usuário confirmou o match ou
// escolheu manualmente); o backend só valida que o ID existe.
// ═════════════════════════════════════════════════════════════════════════

async function listIpi(req, res, next) {
  try {
    const { jobId } = req.params;
    const [rows] = await pool.query(
      `SELECT p.*, d.external_id, d.name AS point_name, d.tax_id, t.code AS tax_code, t.name AS tax_name
       FROM pontos_ipi p
       JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
       LEFT JOIN taxes t ON t.id = d.tax_id
       WHERE p.job_id = ?
       ORDER BY d.name ASC, p.reference_month ASC`,
      [jobId]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function bulkImportIpi(req, res, next) {
  try {
    const { jobId } = req.params;
    const { credit_point_definition_id: pointId, rows } = req.body;
    if (!pointId) throw new ApiError(400, 'Nenhum ponto do catálogo foi selecionado para esta importação.');
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhum valor para importar.');

    await assertJobExists(jobId);

    const [pointRows] = await pool.query(
      `SELECT id, name FROM credit_point_definitions WHERE id = ?`, [pointId]
    );
    if (!pointRows[0]) throw new ApiError(404, 'Ponto não encontrado no catálogo.');
    const point = pointRows[0];

    const conn = await pool.getConnection();
    let inserted = 0;
    try {
      await conn.beginTransaction();
      for (const row of rows) {
        if (!row.reference_month) continue;
        await conn.query(
          `INSERT INTO pontos_ipi (job_id, credit_point_definition_id, reference_month, value)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [jobId, point.id, row.reference_month, num(row.value)]
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
      action: 'IPI_PONTO_IMPORTED',
      entityType: 'pontos_ipi',
      jobId: Number(jobId),
      details: { credit_point_definition_id: point.id, point_name: point.name, inserted },
    });

    res.json({ data: { inserted, pointName: point.name } });
  } catch (err) {
    next(err);
  }
}

const clearIpi = clearPontos('pontos_ipi', 'PONTOS_IPI');

// ═════════════════════════════════════════════════════════════════════════
// Pontos IR/CSLL — anual, split IRPJ/CSLL
//
// Body: { rows: [{ credit_point_definition_id, reference_year, tax_sub_type, value }] }
// Cada linha já vem com o ponto RESOLVIDO pelo frontend (o mesmo
// credit_point_definition_id se repete para todos os anos/tipo de um
// mesmo ponto da planilha).
// ═════════════════════════════════════════════════════════════════════════

async function listIrCsll(req, res, next) {
  try {
    const { jobId } = req.params;
    const [rows] = await pool.query(
      `SELECT p.*, d.external_id, d.name AS point_name, d.tax_id, t.code AS tax_code, t.name AS tax_name
       FROM pontos_ir_csll p
       JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
       LEFT JOIN taxes t ON t.id = d.tax_id
       WHERE p.job_id = ?
       ORDER BY d.name ASC, p.reference_year ASC, p.tax_sub_type ASC`,
      [jobId]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function bulkImportIrCsll(req, res, next) {
  try {
    const { jobId } = req.params;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhum valor para importar.');

    await assertJobExists(jobId);

    const pointIds = [...new Set(rows.map((r) => r.credit_point_definition_id).filter(Boolean))];
    if (pointIds.length === 0) throw new ApiError(400, 'Nenhum ponto do catálogo foi selecionado para esta importação.');

    const [pointRows] = await pool.query(
      `SELECT id, name FROM credit_point_definitions WHERE id IN (?)`, [pointIds]
    );
    const pointById = new Map(pointRows.map((p) => [p.id, p]));

    const missingIds = pointIds.filter((id) => !pointById.has(id));
    if (missingIds.length > 0) {
      throw new ApiError(400, `Ponto(s) não encontrado(s) no catálogo: ${missingIds.join(', ')}.`);
    }

    const conn = await pool.getConnection();
    let totalInserted = 0;
    try {
      await conn.beginTransaction();

      for (const row of rows) {
        const pointId = row.credit_point_definition_id;
        if (!pointId || !row.reference_year || !['IRPJ', 'CSLL'].includes(row.tax_sub_type)) continue;

        await conn.query(
          `INSERT INTO pontos_ir_csll (job_id, credit_point_definition_id, reference_year, tax_sub_type, value)
           VALUES (?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [jobId, pointId, row.reference_year, row.tax_sub_type, num(row.value)]
        );
        totalInserted += 1;
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAction(req, {
      action: 'IR_CSLL_PONTO_IMPORTED',
      entityType: 'pontos_ir_csll',
      jobId: Number(jobId),
      details: { total_inserted: totalInserted, points: Array.from(pointById.values()) },
    });

    res.json({ data: { inserted: totalInserted } });
  } catch (err) {
    next(err);
  }
}

const clearIrCsll = clearPontos('pontos_ir_csll', 'PONTOS_IR_CSLL');

// ═════════════════════════════════════════════════════════════════════════
// Pontos INSS — anual, valor único (sem split, como IPI só que por ano)
//
// Body: { rows: [{ credit_point_definition_id, reference_year, value }] }
// Mesmo padrão de bulkImportIrCsll: 1 arquivo cobre N pontos de uma vez,
// cada linha já vem com o ponto RESOLVIDO pelo frontend (usuário confirmou
// o match, usou o respaldo por ordem, ou criou um ponto novo).
// ═════════════════════════════════════════════════════════════════════════

async function listInss(req, res, next) {
  try {
    const { jobId } = req.params;
    const [rows] = await pool.query(
      `SELECT p.*, d.external_id, d.name AS point_name, d.risk_color, d.tax_id, t.code AS tax_code, t.name AS tax_name
       FROM pontos_inss p
       JOIN credit_point_definitions d ON d.id = p.credit_point_definition_id
       LEFT JOIN taxes t ON t.id = d.tax_id
       WHERE p.job_id = ?
       ORDER BY d.name ASC, p.reference_year ASC`,
      [jobId]
    );
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function bulkImportInss(req, res, next) {
  try {
    const { jobId } = req.params;
    const { rows } = req.body;
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhum valor para importar.');

    await assertJobExists(jobId);

    const pointIds = [...new Set(rows.map((r) => r.credit_point_definition_id).filter(Boolean))];
    if (pointIds.length === 0) throw new ApiError(400, 'Nenhum ponto do catálogo foi selecionado para esta importação.');

    const [pointRows] = await pool.query(
      `SELECT id, name FROM credit_point_definitions WHERE id IN (?)`, [pointIds]
    );
    const pointById = new Map(pointRows.map((p) => [p.id, p]));

    const missingIds = pointIds.filter((id) => !pointById.has(id));
    if (missingIds.length > 0) {
      throw new ApiError(400, `Ponto(s) não encontrado(s) no catálogo: ${missingIds.join(', ')}.`);
    }

    const conn = await pool.getConnection();
    let totalInserted = 0;
    try {
      await conn.beginTransaction();

      for (const row of rows) {
        const pointId = row.credit_point_definition_id;
        if (!pointId || !row.reference_year) continue;

        await conn.query(
          `INSERT INTO pontos_inss (job_id, credit_point_definition_id, reference_year, value)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE value = VALUES(value)`,
          [jobId, pointId, row.reference_year, num(row.value)]
        );
        totalInserted += 1;
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAction(req, {
      action: 'INSS_PONTO_IMPORTED',
      entityType: 'pontos_inss',
      jobId: Number(jobId),
      details: { total_inserted: totalInserted, points: Array.from(pointById.values()) },
    });

    res.json({ data: { inserted: totalInserted } });
  } catch (err) {
    next(err);
  }
}

const clearInss = clearPontos('pontos_inss', 'PONTOS_INSS');

// ─── Credit point definitions (catálogo global de pontos) ────────────────────

/**
 * GET /credit-point-definitions?category=ADM&tax=IPI&nature=CREDITO&search=...
 * `nature` é usado principalmente pelos wizards de IPI/IR-CSLL para listar
 * só candidatos de crédito (nunca casar com um ponto Passivo por engano).
 */
async function listDefinitions(req, res, next) {
  try {
    const { category, tax, nature, search } = req.query;

    let sql = `SELECT d.id, d.category, d.tax_id, t.code AS tax_code, t.name AS tax_name,
                      d.nature, d.external_id, d.name, d.risk_color, d.created_at, d.updated_at
               FROM credit_point_definitions d
               LEFT JOIN taxes t ON t.id = d.tax_id
               WHERE 1=1`;
    const params = [];

    if (category) { sql += ` AND d.category = ?`; params.push(category); }
    if (tax) { sql += ` AND t.code = ?`; params.push(tax); }
    if (nature) { sql += ` AND d.nature = ?`; params.push(nature); }
    if (search) {
      sql += ` AND (d.name LIKE ? OR d.external_id LIKE ?)`;
      params.push(`%${search}%`, `%${search}%`);
    }

    sql += ` ORDER BY d.category ASC, t.name ASC,
                      COALESCE(NULLIF(TRIM(d.name), ''), '\xff') ASC,
                      d.external_id ASC`;

    const [rows] = await pool.query(sql, params);
    res.json({ data: rows });
  } catch (err) {
    next(err);
  }
}

async function updateDefinitionName(req, res, next) {
  try {
    const { id } = req.params;
    const { name, risk_color: riskColor, tax_code: taxCode } = req.body;

    if (name !== undefined && !name.trim()) throw new ApiError(400, 'O nome não pode estar vazio.');
    if (riskColor !== undefined && riskColor !== null && !VALID_COLORS.includes(riskColor)) {
      throw new ApiError(400, 'Cor de risco inválida.');
    }

    const [existing] = await pool.query(
      `SELECT id, category, external_id, name, risk_color, tax_id FROM credit_point_definitions WHERE id = ?`,
      [id]
    );
    if (!existing[0]) throw new ApiError(404, 'Definição de ponto não encontrada.');

    const updates = {};
    if (name !== undefined) updates.name = name.trim();
    if (riskColor !== undefined) updates.risk_color = riskColor;
    if (taxCode !== undefined) {
      const [taxRows] = await pool.query(`SELECT id FROM taxes WHERE code = ?`, [taxCode]);
      if (!taxRows[0]) throw new ApiError(400, 'Tributo inválido.');
      updates.tax_id = taxRows[0].id;
    }

    if (Object.keys(updates).length === 0) throw new ApiError(400, 'Nenhum campo para atualizar.');

    const setClauses = Object.keys(updates).map((k) => `${k} = ?`).join(', ');
    await pool.query(
      `UPDATE credit_point_definitions SET ${setClauses} WHERE id = ?`,
      [...Object.values(updates), id]
    );

    await logAction(req, {
      action: 'CREDIT_POINT_DEF_UPDATED',
      entityType: 'credit_point_definitions',
      entityId: Number(id),
      details: { before: existing[0], updates },
    });

    const [updated] = await pool.query(
      `SELECT d.id, d.category, d.tax_id, t.code AS tax_code, d.nature, d.external_id, d.name, d.risk_color, d.updated_at
       FROM credit_point_definitions d LEFT JOIN taxes t ON t.id = d.tax_id WHERE d.id = ?`,
      [id]
    );
    res.json({ data: updated[0] });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /credit-point-definitions/bulk-import
 * (Importação em massa da tabela mestre — PRT/Fintax. Ver nota no início
 * do arquivo sobre por que IPI/IR-CSLL não usam mais este mecanismo de
 * match automático para os VALORES por job — isto aqui é só para o
 * catálogo/definições, continua igual.)
 */
async function bulkImportDefinitions(req, res, next) {
  try {
    const { category, tax_code: defaultTaxCode, nature: defaultNature, rows } = req.body;
    if (!['ADM', 'FTX'].includes(category)) throw new ApiError(400, 'Categoria inválida.');
    if (!Array.isArray(rows) || rows.length === 0) throw new ApiError(400, 'Nenhuma linha para importar.');

    const conn = await pool.getConnection();
    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const unknownTaxCodes = new Set();

    try {
      await conn.beginTransaction();

      const taxIdCache = new Map();
      async function resolveTaxId(code) {
        if (!code) return null;
        if (taxIdCache.has(code)) return taxIdCache.get(code);
        const [taxRows] = await conn.query('SELECT id FROM taxes WHERE code = ?', [code]);
        const id = taxRows[0]?.id ?? null;
        taxIdCache.set(code, id);
        return id;
      }

      for (const row of rows) {
        const externalId = String(row.external_id ?? '').trim();
        const name = String(row.name ?? '').trim();
        if (!externalId || !name) { skipped += 1; continue; }

        const rowTaxCode = row.tax_code || defaultTaxCode;
        if (!rowTaxCode) { skipped += 1; continue; }

        const taxId = await resolveTaxId(rowTaxCode);
        if (!taxId) { unknownTaxCodes.add(rowTaxCode); skipped += 1; continue; }

        const rowNature = VALID_NATURES.includes(row.nature) ? row.nature
          : (VALID_NATURES.includes(defaultNature) ? defaultNature : 'CREDITO');

        const riskColor = category === 'FTX' && VALID_COLORS.includes(row.risk_color) ? row.risk_color : null;

        const [existing] = await conn.query(
          `SELECT id FROM credit_point_definitions WHERE category = ? AND external_id = ? LIMIT 1`,
          [category, externalId]
        );

        if (existing[0]) {
          await conn.query(
            `UPDATE credit_point_definitions SET name = ?, risk_color = ?, tax_id = ?, nature = ? WHERE id = ?`,
            [name, riskColor, taxId, rowNature, existing[0].id]
          );
          updated += 1;
        } else {
          await conn.query(
            `INSERT INTO credit_point_definitions (category, tax_id, nature, external_id, name, risk_color)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [category, taxId, rowNature, externalId, name, riskColor]
          );
          inserted += 1;
        }
      }

      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }

    await logAction(req, {
      action: 'CREDIT_POINT_DEFS_BULK_IMPORTED',
      entityType: 'credit_point_definitions',
      details: {
        category, default_tax_code: defaultTaxCode, default_nature: defaultNature,
        inserted, updated, skipped, total_rows: rows.length,
        unknown_tax_codes: Array.from(unknownTaxCodes),
      },
    });

    res.json({ data: { inserted, updated, skipped, unknownTaxCodes: Array.from(unknownTaxCodes) } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /credit-point-definitions/quick-create
 * Criação manual de UM ponto, usada pelos wizards de IPI/IR-CSLL quando o
 * usuário confirma explicitamente "não existe no catálogo, criar novo"
 * (nunca automático/silencioso). external_id fica com um marcador
 * "manual:<id>" só para satisfazer a constraint de unicidade — esses
 * pontos não têm um ID de origem real.
 */
async function quickCreateDefinition(req, res, next) {
  try {
    const { category, tax_code: taxCode, name, nature } = req.body;
    if (!['ADM', 'FTX'].includes(category)) throw new ApiError(400, 'Categoria inválida.');
    if (!taxCode) throw new ApiError(400, 'Tributo é obrigatório.');
    if (!name || !name.trim()) throw new ApiError(400, 'Nome é obrigatório.');

    const [taxRows] = await pool.query('SELECT id FROM taxes WHERE code = ?', [taxCode]);
    if (!taxRows[0]) throw new ApiError(400, 'Tributo inválido.');

    const finalNature = VALID_NATURES.includes(nature) ? nature : 'CREDITO';
    const externalId = `manual:${Date.now()}${Math.floor(Math.random() * 1000)}`;

    const [result] = await pool.query(
      `INSERT INTO credit_point_definitions (category, tax_id, nature, external_id, name)
       VALUES (?, ?, ?, ?, ?)`,
      [category, taxRows[0].id, finalNature, externalId, name.trim()]
    );

    await logAction(req, {
      action: 'CREDIT_POINT_DEF_QUICK_CREATED',
      entityType: 'credit_point_definitions',
      entityId: result.insertId,
      details: { category, tax_code: taxCode, nature: finalNature, name },
    });

    res.status(201).json({ data: { id: result.insertId, name: name.trim(), external_id: externalId } });
  } catch (err) {
    next(err);
  }
}

async function removeDefinition(req, res, next) {
  try {
    const { id } = req.params;

    const [existing] = await pool.query(
      `SELECT id, category, external_id, name FROM credit_point_definitions WHERE id = ?`,
      [id]
    );
    if (!existing[0]) throw new ApiError(404, 'Definição de ponto não encontrada.');

    const [[{ admCount }]] = await pool.query(
      `SELECT COUNT(*) AS admCount FROM pontos_adm WHERE credit_point_definition_id = ?`, [id]
    );
    const [[{ ftxCount }]] = await pool.query(
      `SELECT COUNT(*) AS ftxCount FROM pontos_ftx WHERE credit_point_definition_id = ?`, [id]
    );
    const [[{ ipiCount }]] = await pool.query(
      `SELECT COUNT(*) AS ipiCount FROM pontos_ipi WHERE credit_point_definition_id = ?`, [id]
    );
    const [[{ irCsllCount }]] = await pool.query(
      `SELECT COUNT(*) AS irCsllCount FROM pontos_ir_csll WHERE credit_point_definition_id = ?`, [id]
    );
    const [[{ inssCount }]] = await pool.query(
      `SELECT COUNT(*) AS inssCount FROM pontos_inss WHERE credit_point_definition_id = ?`, [id]
    );
    if (Number(admCount) + Number(ftxCount) + Number(ipiCount) + Number(irCsllCount) + Number(inssCount) > 0) {
      throw new ApiError(409, 'Não é possível excluir: este ponto já tem valores importados em algum job.');
    }

    await pool.query(`DELETE FROM job_point_notes WHERE credit_point_definition_id = ?`, [id]);
    await pool.query(`DELETE FROM credit_point_definitions WHERE id = ?`, [id]);

    await logAction(req, {
      action: 'CREDIT_POINT_DEF_DELETED',
      entityType: 'credit_point_definitions',
      entityId: Number(id),
      details: existing[0],
    });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /credit-point-definitions
 * Zera TUDO relacionado a pontos: definições do catálogo global E todos os
 * valores já importados em QUALQUER job. Destrutivo e irreversível.
 */
async function resetAllDefinitions(req, res, next) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [[{ c1 }]] = await conn.query('SELECT COUNT(*) AS c1 FROM job_point_notes');
    const [[{ c2 }]] = await conn.query('SELECT COUNT(*) AS c2 FROM pontos_adm');
    const [[{ c3 }]] = await conn.query('SELECT COUNT(*) AS c3 FROM pontos_ftx');
    const [[{ c4 }]] = await conn.query('SELECT COUNT(*) AS c4 FROM pontos_ipi');
    const [[{ c5 }]] = await conn.query('SELECT COUNT(*) AS c5 FROM pontos_ir_csll');
    const [[{ c7 }]] = await conn.query('SELECT COUNT(*) AS c7 FROM pontos_inss');
    const [[{ c6 }]] = await conn.query('SELECT COUNT(*) AS c6 FROM credit_point_definitions');

    await conn.query('DELETE FROM job_point_notes');
    await conn.query('DELETE FROM pontos_adm');
    await conn.query('DELETE FROM pontos_ftx');
    await conn.query('DELETE FROM pontos_ipi');
    await conn.query('DELETE FROM pontos_ir_csll');
    await conn.query('DELETE FROM pontos_inss');
    await conn.query('DELETE FROM credit_point_definitions');

    await conn.commit();

    const deleted = {
      job_point_notes: c1,
      pontos_adm: c2,
      pontos_ftx: c3,
      pontos_ipi: c4,
      pontos_ir_csll: c5,
      pontos_inss: c7,
      credit_point_definitions: c6,
    };

    await logAction(req, {
      action: 'CREDIT_POINT_DEFINITIONS_RESET_ALL',
      entityType: 'credit_point_definitions',
      details: deleted,
    });

    res.json({ data: { deleted } });
  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
}

module.exports = {
  listAdm, bulkImportAdm, clearAdm,
  listFtx, bulkImportFtx, clearFtx,
  listIpi, bulkImportIpi, clearIpi,
  listIrCsll, bulkImportIrCsll, clearIrCsll,
  listInss, bulkImportInss, clearInss,
  listDefinitions, updateDefinitionName, bulkImportDefinitions,
  quickCreateDefinition, removeDefinition, resetAllDefinitions,
};