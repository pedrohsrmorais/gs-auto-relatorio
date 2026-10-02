const { pool } = require('../config/database');

/* =====================================================================
 * logService.js — serviço centralizado de auditoria.
 *
 * Chamado por TODOS os controllers em vez de duplicar a lógica de INSERT
 * em cada um. Adiciona user_name ao registro (para relatórios de
 * produtividade sem necessitar de JOIN com users em cada consulta).
 *
 * Migração necessária antes de usar:
 *   ALTER TABLE audit_logs
 *     ADD COLUMN user_name VARCHAR(120) NULL AFTER user_id;
 * ===================================================================== */

/**
 * Registra uma ação no log de auditoria.
 *
 * @param {import('express').Request} req  — Express request (deve ter req.user definido pelo middleware identify)
 * @param {{ action: string, entityType?: string|null, entityId?: number|null, jobId?: number|null, details?: object|null }} opts
 */
async function record(req, { action, entityType = null, entityId = null, jobId = null, details = null }) {
  try {
    await pool.query(
      `INSERT INTO audit_logs
         (user_id, user_name, action, entity_type, entity_id, job_id, details, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        req.user?.id   ?? null,
        req.user?.name ?? null,
        action,
        entityType,
        entityId,
        jobId,
        details ? JSON.stringify(details) : null,
        req.ip ?? null,
      ]
    );
  } catch (err) {
    // Nunca deixa um erro de log derrubar a requisição principal.
    // Se a coluna user_name ainda não existir (migração pendente),
    // retenta sem ela para não bloquear o fluxo.
    if (err.code === 'ER_BAD_FIELD_ERROR') {
      try {
        await pool.query(
          `INSERT INTO audit_logs
             (user_id, action, entity_type, entity_id, job_id, details, ip_address)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            req.user?.id ?? null,
            action,
            entityType,
            entityId,
            jobId,
            details ? JSON.stringify(details) : null,
            req.ip ?? null,
          ]
        );
        console.warn('[audit] user_name ausente em audit_logs — execute: ALTER TABLE audit_logs ADD COLUMN user_name VARCHAR(120) NULL AFTER user_id;');
      } catch (fallbackErr) {
        console.error('[audit] Falha ao registrar log (fallback):', fallbackErr.message);
      }
    } else {
      console.error('[audit] Falha ao registrar log:', err.message);
    }
  }
}

module.exports = { record };