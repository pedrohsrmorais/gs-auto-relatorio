-- =====================================================================
-- init.sql — Grupo Studio Auto (studio_fiscal)
-- ---------------------------------------------------------------------
-- Script de criação completa do banco, na ordem correta de dependências
-- de chave estrangeira. Colar direto num client MySQL 8+ monta toda a
-- estrutura do zero.
-- =====================================================================

SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- users
-- =====================================================================
DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `name` varchar(150) NOT NULL,
  `email` varchar(150) NOT NULL,
  `password_hash` varchar(255) NOT NULL COMMENT 'bcrypt/argon2 hash — nunca salvar em texto puro',
  `role` enum('admin','user') NOT NULL DEFAULT 'user',
  `job_title` enum('Analista Fiscal','Analista Tributário','Coordenador Tributário','Coordenadora Tributária','Gerente Tributário','Head Tributário') DEFAULT NULL,
  `has_signature` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'coluna "TEM ASSINATURA" (SIM/NÃO)',
  `signature_file_path` varchar(255) DEFAULT NULL COMMENT 'caminho da imagem de assinatura usada nos pareceres gerados',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `last_login_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_users_email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- clients
-- =====================================================================
DROP TABLE IF EXISTS `clients`;
CREATE TABLE `clients` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `cnpj` char(14) NOT NULL COMMENT 'somente dígitos, sem máscara',
  `company_name` varchar(255) NOT NULL COMMENT 'CLIENTE / Razão Social',
  `segment` varchar(150) DEFAULT NULL COMMENT 'SEGMENTO',
  `tax_regime` enum('Lucro Real','Lucro Presumido','Simples Nacional','Lucro Arbitrado') DEFAULT NULL COMMENT 'REGIME TRIBUTÁRIO (pode variar por Job/período)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_clients_cnpj` (`cnpj`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- taxes (tabela de referência — dado fixo do domínio fiscal)
-- =====================================================================
DROP TABLE IF EXISTS `taxes`;
CREATE TABLE `taxes` (
  `id` tinyint unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(20) NOT NULL COMMENT 'PIS_COFINS | IRPJ_CSLL | INSS | IPI',
  `name` varchar(50) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_taxes_code` (`code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

INSERT INTO `taxes` (`code`, `name`) VALUES
  ('PIS_COFINS', 'PIS/COFINS'),
  ('IRPJ_CSLL', 'IRPJ/CSLL'),
  ('INSS', 'INSS'),
  ('IPI', 'IPI');

-- =====================================================================
-- jobs (depende de clients, users)
-- =====================================================================
DROP TABLE IF EXISTS `jobs`;
CREATE TABLE `jobs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_number` varchar(50) NOT NULL COMMENT 'Nº JOB',
  `client_id` bigint unsigned NOT NULL,
  `period_start` date NOT NULL COMMENT 'PERÍODO INICIAL',
  `period_end` date NOT NULL COMMENT 'PERÍODO FINAL',
  `tax_regime` enum('Lucro Real','Lucro Presumido','Simples Nacional','Lucro Arbitrado') DEFAULT NULL,
  `segment` varchar(150) DEFAULT NULL,
  `status` enum('diagnostico','em_analise','revisao','parecer_emitido','concluido','cancelado') NOT NULL DEFAULT 'diagnostico',
  `created_by` bigint unsigned DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jobs_number` (`job_number`),
  KEY `fk_jobs_created_by` (`created_by`),
  KEY `idx_jobs_client` (`client_id`),
  KEY `idx_jobs_status` (`status`),
  CONSTRAINT `fk_jobs_client` FOREIGN KEY (`client_id`) REFERENCES `clients` (`id`),
  CONSTRAINT `fk_jobs_created_by` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- refresh_tokens (depende de users)
-- =====================================================================
DROP TABLE IF EXISTS `refresh_tokens`;
CREATE TABLE `refresh_tokens` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned NOT NULL,
  `token_hash` varchar(255) NOT NULL COMMENT 'hash do refresh token, nunca o valor puro',
  `expires_at` datetime NOT NULL,
  `revoked_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_refresh_tokens_user` (`user_id`),
  CONSTRAINT `fk_refresh_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_team_members (depende de jobs, users)
-- Um usuário por papel por job — cf. job.controller.js (setTeamMember
-- usa ON DUPLICATE KEY UPDATE assumindo essa unicidade).
-- =====================================================================
DROP TABLE IF EXISTS `job_team_members`;
CREATE TABLE `job_team_members` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `user_id` bigint unsigned NOT NULL,
  `role_in_job` enum('responsavel_tecnico','gerente_tributario','coordenador_tributario','analista_fiscal','gerente_previdenciario','coordenador_previdenciario','analista_previdenciario') NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_role` (`job_id`,`role_in_job`),
  KEY `fk_job_team_user` (`user_id`),
  CONSTRAINT `fk_job_team_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_job_team_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_diagnostics (1:1 com jobs)
-- =====================================================================
DROP TABLE IF EXISTS `job_diagnostics`;
CREATE TABLE `job_diagnostics` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `pays_darf` tinyint(1) DEFAULT NULL COMMENT 'P1: empresa paga DARF?',
  `avg_monthly_pis_cofins` decimal(18,2) DEFAULT NULL,
  `avg_yearly_pis_cofins` decimal(18,2) DEFAULT NULL,
  `avg_monthly_irpj_csll` decimal(18,2) DEFAULT NULL,
  `avg_yearly_irpj_csll` decimal(18,2) DEFAULT NULL,
  `avg_monthly_inss` decimal(18,2) DEFAULT NULL,
  `avg_yearly_inss` decimal(18,2) DEFAULT NULL,
  `avg_monthly_ipi` decimal(18,2) DEFAULT NULL,
  `avg_yearly_ipi` decimal(18,2) DEFAULT NULL,
  `collection_method` text COMMENT 'P3: DARF, parcelamento, compensação, saldo credor...',
  `opportunities_above_500k` tinyint(1) DEFAULT NULL COMMENT 'P4',
  `already_credits_risk_point` tinyint(1) DEFAULT NULL COMMENT 'P5',
  `has_debts_with_rfb` tinyint(1) DEFAULT NULL COMMENT 'P6: parcelamentos com a RFB',
  `usage_plan` text COMMENT 'P7: restituição, ressarcimento, escritural ou extemporâneo',
  `estimated_usage_months` int DEFAULT NULL COMMENT 'P8: tempo estimado de utilização em meses',
  `observations` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_diagnostics_job` (`job_id`),
  CONSTRAINT `fk_job_diagnostics_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_perdcomps (depende de jobs)
-- perdcomp_number é único globalmente — perdcomp.controller.js faz
-- upsert por esse número no bulk-import.
-- =====================================================================
DROP TABLE IF EXISTS `job_perdcomps`;
CREATE TABLE `job_perdcomps` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `perdcomp_number` varchar(50) NOT NULL,
  `transmission_date` date DEFAULT NULL,
  `credit_type` varchar(100) DEFAULT NULL,
  `document_type` varchar(100) DEFAULT NULL,
  `status` enum('EM_ANALISE','HOMOLOGADA','NAO_HOMOLOGADA','CANCELADA','RETIFICADA') NOT NULL DEFAULT 'EM_ANALISE',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_perdcomp_number` (`perdcomp_number`),
  KEY `fk_perdcomp_job` (`job_id`),
  CONSTRAINT `fk_perdcomp_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_darf_entries (depende de jobs)
-- =====================================================================
DROP TABLE IF EXISTS `job_darf_entries`;
CREATE TABLE `job_darf_entries` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `data_base` date DEFAULT NULL,
  `darf_code` varchar(20) DEFAULT NULL COMMENT 'coluna DARF',
  `collection_date` date DEFAULT NULL COMMENT 'DATA_ARRECADACAO',
  `due_date` date DEFAULT NULL COMMENT 'DATA_VENCIMENTO',
  `assessment_period` varchar(10) DEFAULT NULL COMMENT 'PERIODO_APURACAO, ex: 03/2024',
  `revenue_code` varchar(20) DEFAULT NULL COMMENT 'CODIGO_RECEITA',
  `name` varchar(255) DEFAULT NULL COMMENT 'NOME (descrição da receita)',
  `document_number` varchar(50) DEFAULT NULL COMMENT 'NUMERO_DOCUMENTO',
  `total_value` decimal(18,2) NOT NULL DEFAULT '0.00',
  `days_late` int NOT NULL DEFAULT '0',
  `principal_value` decimal(18,2) NOT NULL DEFAULT '0.00',
  `fine_value` decimal(18,2) NOT NULL DEFAULT '0.00',
  `interest_value` decimal(18,2) NOT NULL DEFAULT '0.00',
  `tax_group` varchar(50) DEFAULT NULL COMMENT 'GRUPO_TRIBUTO',
  `cnpj` char(14) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_darf_job_period` (`job_id`,`assessment_period`),
  CONSTRAINT `fk_darf_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_sped_m400_entries (depende de jobs)
-- =====================================================================
DROP TABLE IF EXISTS `job_sped_m400_entries`;
CREATE TABLE `job_sped_m400_entries` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `reference_month` date NOT NULL COMMENT 'ANO + MES, sempre dia 01',
  `establishment` varchar(100) DEFAULT NULL,
  `reg` varchar(10) DEFAULT NULL COMMENT 'REG',
  `cst` varchar(10) DEFAULT NULL COMMENT 'CÓDIGO DE SITUAÇÃO TRIBUTÁRIA',
  `gross_revenue_value` decimal(18,2) NOT NULL DEFAULT '0.00',
  `accounting_account_code` varchar(50) DEFAULT NULL,
  `revenue_description` varchar(255) DEFAULT NULL,
  `bookkeeping_type` varchar(50) DEFAULT NULL COMMENT 'TIPO_ESCRIT',
  `data_base` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_m400_job_month` (`job_id`,`reference_month`),
  CONSTRAINT `fk_m400_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_sped_m610_entries (depende de jobs)
-- =====================================================================
DROP TABLE IF EXISTS `job_sped_m610_entries`;
CREATE TABLE `job_sped_m610_entries` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `reference_month` date NOT NULL,
  `establishment` varchar(100) DEFAULT NULL,
  `contribution_code` varchar(20) DEFAULT NULL COMMENT 'COD_CONT',
  `contribution_description` varchar(255) DEFAULT NULL,
  `gross_revenue_value` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT 'VL_REC_BRT',
  `calculation_base_value` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT 'VL_BC_CONT',
  `pis_aliquot` decimal(9,4) NOT NULL DEFAULT '0.0000' COMMENT 'ALIQ_PISA',
  `pis_quantity` decimal(18,4) NOT NULL DEFAULT '0.0000' COMMENT 'QUANT_BC_PIS',
  `pis_quantity_aliquot` decimal(9,4) NOT NULL DEFAULT '0.0000' COMMENT 'ALIQ_PIS_QUANT',
  `total_contribution_calculated` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT 'VL_CONT_APUR',
  `addition_adjustments_value` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT 'VL_AJUS_ACRES',
  `reduction_adjustments_value` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT 'VL_AJUS_REDUC',
  `deferred_contribution_value` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT 'VL_CONT_DIFER',
  `previous_deferred_contribution_value` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT 'VL_CONT_DIFER_ANT',
  `total_period_contribution_value` decimal(18,2) NOT NULL DEFAULT '0.00' COMMENT 'VL_CONT_PER',
  `bookkeeping_type` varchar(50) DEFAULT NULL,
  `data_base` date DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_m610_job_month` (`job_id`,`reference_month`),
  CONSTRAINT `fk_m610_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- credit_points (depende de taxes) — catálogo mestre de pontos de crédito
-- =====================================================================
DROP TABLE IF EXISTS `credit_points`;
CREATE TABLE `credit_points` (
  `id` int unsigned NOT NULL AUTO_INCREMENT,
  `tax_id` tinyint unsigned NOT NULL,
  `name` varchar(255) NOT NULL COMMENT 'ex: "Aluguel De Prédios", "Subvenção para Investimentos"',
  `category` enum('ADM','FINTAX') NOT NULL DEFAULT 'ADM',
  `risk_color` enum('VERDE','AMARELO','VERMELHO') DEFAULT NULL COMMENT 'somente para category = FINTAX',
  `legal_criteria` text COMMENT 'coluna "Critérios para apontarmos" / fundamentação legal',
  `is_active` tinyint(1) NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_credit_point_name` (`tax_id`,`name`),
  KEY `idx_credit_points_category` (`category`,`risk_color`),
  CONSTRAINT `fk_credit_points_tax` FOREIGN KEY (`tax_id`) REFERENCES `taxes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_credit_point_analyses (depende de jobs, credit_points, users)
-- =====================================================================
DROP TABLE IF EXISTS `job_credit_point_analyses`;
CREATE TABLE `job_credit_point_analyses` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `credit_point_id` int unsigned NOT NULL,
  `has_credit` tinyint(1) NOT NULL DEFAULT '0' COMMENT 'ponto identificado como aproveitável neste Job',
  `observations` text COMMENT 'coluna OBSERVAÇÕES',
  `total_credit_value` decimal(18,2) NOT NULL DEFAULT '0.00',
  `analyzed_by` bigint unsigned DEFAULT NULL,
  `analyzed_at` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_job_point` (`job_id`,`credit_point_id`),
  KEY `fk_jcpa_credit_point` (`credit_point_id`),
  KEY `fk_jcpa_analyzed_by` (`analyzed_by`),
  CONSTRAINT `fk_jcpa_analyzed_by` FOREIGN KEY (`analyzed_by`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_jcpa_credit_point` FOREIGN KEY (`credit_point_id`) REFERENCES `credit_points` (`id`),
  CONSTRAINT `fk_jcpa_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_credit_monthly_values (depende de job_credit_point_analyses)
-- =====================================================================
DROP TABLE IF EXISTS `job_credit_monthly_values`;
CREATE TABLE `job_credit_monthly_values` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_credit_point_analysis_id` bigint unsigned NOT NULL,
  `contribution` enum('PIS','COFINS') DEFAULT NULL COMMENT 'preenchido apenas quando o tributo do ponto é PIS/COFINS; NULL para os demais',
  `reference_month` date NOT NULL COMMENT 'sempre dia 01 do mês/ano de competência, ex: 2024-03-01',
  `value` decimal(18,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jcmv_month` (`job_credit_point_analysis_id`,`contribution`,`reference_month`),
  CONSTRAINT `fk_jcmv_analysis` FOREIGN KEY (`job_credit_point_analysis_id`) REFERENCES `job_credit_point_analyses` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_credit_usages (depende de jobs)
-- =====================================================================
DROP TABLE IF EXISTS `job_credit_usages`;
CREATE TABLE `job_credit_usages` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `reference_month` date NOT NULL COMMENT 'dia 01 do mês de competência',
  `pis_credit` decimal(18,2) NOT NULL DEFAULT '0.00',
  `darf_collected` decimal(18,2) NOT NULL DEFAULT '0.00',
  `month_excess` decimal(18,2) NOT NULL DEFAULT '0.00',
  `balance_to_update` decimal(18,2) NOT NULL DEFAULT '0.00',
  `excess_used` decimal(18,2) NOT NULL DEFAULT '0.00',
  `restitution_update_value` decimal(18,2) NOT NULL DEFAULT '0.00',
  `pct_untaxed_outputs` decimal(7,4) NOT NULL DEFAULT '0.0000',
  `fintax_pis_credit` decimal(18,2) NOT NULL DEFAULT '0.00',
  `restitution_total` decimal(18,2) NOT NULL DEFAULT '0.00',
  `restitution_green` decimal(18,2) NOT NULL DEFAULT '0.00',
  `restitution_yellow` decimal(18,2) NOT NULL DEFAULT '0.00',
  `restitution_red` decimal(18,2) NOT NULL DEFAULT '0.00',
  `refund_total` decimal(18,2) NOT NULL DEFAULT '0.00',
  `refund_green` decimal(18,2) NOT NULL DEFAULT '0.00',
  `refund_yellow` decimal(18,2) NOT NULL DEFAULT '0.00',
  `refund_red` decimal(18,2) NOT NULL DEFAULT '0.00',
  `bookkeeping_total` decimal(18,2) NOT NULL DEFAULT '0.00',
  `bookkeeping_green` decimal(18,2) NOT NULL DEFAULT '0.00',
  `bookkeeping_yellow` decimal(18,2) NOT NULL DEFAULT '0.00',
  `bookkeeping_red` decimal(18,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_jcu_month` (`job_id`,`reference_month`),
  CONSTRAINT `fk_jcu_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- job_reports (depende de jobs, taxes, users)
-- =====================================================================
DROP TABLE IF EXISTS `job_reports`;
CREATE TABLE `job_reports` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `job_id` bigint unsigned NOT NULL,
  `tax_id` tinyint unsigned DEFAULT NULL,
  `report_type` enum('PARECER_CREDITO','PARECER_NAO_CREDITO') NOT NULL,
  `conclusion_date` date DEFAULT NULL,
  `responsible_user_id` bigint unsigned DEFAULT NULL,
  `file_path` varchar(255) DEFAULT NULL COMMENT 'PDF/DOCX/PPTX gerado',
  `status` enum('rascunho','finalizado','assinado') NOT NULL DEFAULT 'rascunho',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_reports_job` (`job_id`),
  KEY `fk_reports_tax` (`tax_id`),
  KEY `fk_reports_responsible` (`responsible_user_id`),
  CONSTRAINT `fk_reports_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE CASCADE,
  CONSTRAINT `fk_reports_responsible` FOREIGN KEY (`responsible_user_id`) REFERENCES `users` (`id`),
  CONSTRAINT `fk_reports_tax` FOREIGN KEY (`tax_id`) REFERENCES `taxes` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- =====================================================================
-- audit_logs (depende de users, jobs)
-- Gravada localmente em cada controller de escrita (auth, users, job,
-- perdcomp, darf) via função logAction() própria de cada arquivo.
-- =====================================================================
DROP TABLE IF EXISTS `audit_logs`;
CREATE TABLE `audit_logs` (
  `id` bigint unsigned NOT NULL AUTO_INCREMENT,
  `user_id` bigint unsigned DEFAULT NULL COMMENT 'NULL se o usuário foi removido depois',
  `action` varchar(100) NOT NULL COMMENT 'ex: LOGIN, JOB_CREATED, PERDCOMP_IMPORTED',
  `entity_type` varchar(50) DEFAULT NULL COMMENT 'ex: job, perdcomp, darf_entry, user',
  `entity_id` bigint unsigned DEFAULT NULL COMMENT 'NULL em ações em lote (bulk import)',
  `job_id` bigint unsigned DEFAULT NULL COMMENT 'preenchido quando a ação está ligada a um job',
  `details` json DEFAULT NULL COMMENT 'payload livre: contagens, valores antigos/novos, etc.',
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_audit_logs_user` (`user_id`),
  KEY `idx_audit_logs_job` (`job_id`),
  KEY `idx_audit_logs_entity` (`entity_type`,`entity_id`),
  KEY `idx_audit_logs_created` (`created_at`),
  CONSTRAINT `fk_audit_logs_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL,
  CONSTRAINT `fk_audit_logs_job` FOREIGN KEY (`job_id`) REFERENCES `jobs` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;