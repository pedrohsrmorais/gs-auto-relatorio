-- ============================================================================
-- Migração: remove o fluxo antigo "por tributo" (Sistema B) e o Comparativo
-- por Categoria (Relatório 2), que foram substituídos pelo Diagnóstico por
-- ponto (ADM/FTX) e pelo catálogo global de pontos com cor (FTX).
--
-- IMPORTANTE: rode isso só depois de deployar o backend/frontend atualizados
-- (que não leem/escrevem mais essas tabelas/colunas). credit_points estava
-- vazia em produção (nenhum INSERT no dump analisado) — Sistema B nunca
-- chegou a ser usado de fato.
--
-- `taxes` NÃO é removida aqui: job_reports.tax_id ainda referencia essa
-- tabela (geração de parecer), feature separada do que estamos limpando.
-- ============================================================================

-- 1) Sistema B ("por tributo"): TributoPanel / RevisaoPonto no front,
--    jobCreditAnalysisApi. Ordem de DROP respeita as FKs (filha primeiro).
DROP TABLE IF EXISTS job_credit_monthly_values;
DROP TABLE IF EXISTS job_credit_point_analyses;
DROP TABLE IF EXISTS credit_points;

-- 2) Comparativo por Categoria (Relatório 2): CategoriaImportWizard,
--    ftxCategoriaApi, diagnosticsColorsApi, aba "Cores" do Diagnóstico.
DROP TABLE IF EXISTS pontos_ftx_categoria;

-- 3) Cor de risco por job (job_point_notes.risk_color) não é mais editável
--    nem lida pelo backend — a cor agora vive só em
--    credit_point_definitions.risk_color (catálogo global). A coluna de
--    observações (job_point_notes.observations) NÃO é afetada.
ALTER TABLE job_point_notes DROP COLUMN risk_color;
