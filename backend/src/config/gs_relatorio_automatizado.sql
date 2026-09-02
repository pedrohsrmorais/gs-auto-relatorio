-- =====================================================================
-- STUDIO FISCAL — SCHEMA MySQL 8+
-- Baseado no mapeamento de "PLANO_DE_TRABALHO_E_RELATÓRIOS_v8_6.xlsm"
-- Gerado em 2026-09-01
--
-- Convenção: tabelas/colunas em inglês (snake_case) — padrão comum em
-- projetos Node/Express/Sequelize — com comentários em português
-- indicando a aba/origem no Excel para rastreabilidade.
-- =====================================================================

CREATE DATABASE IF NOT EXISTS studio_fiscal
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE studio_fiscal;

SET FOREIGN_KEY_CHECKS = 0;

-- =====================================================================
-- 1. AUTENTICAÇÃO / RBAC
-- Origem: aba "CADASTRO ASSINATURAS" (equipe: nome, cargo, e-mail,
-- tem assinatura) + requisito da API (admin/user)
-- =====================================================================

CREATE TABLE users (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name              VARCHAR(150)      NOT NULL,
  email             VARCHAR(150)      NOT NULL,
  password_hash     VARCHAR(255)      NOT NULL COMMENT 'bcrypt/argon2 hash — nunca salvar em texto puro',

  -- Permissão de acesso à API (o que você pediu explicitamente)
  role              ENUM('admin', 'user') NOT NULL DEFAULT 'user',

  -- Cargo dentro do Grupo Studio (aba CADASTRO ASSINATURAS, coluna CARGO)
  -- Usado para exibir responsabilidades nos Jobs/Pareceres, não para permissão de API
  job_title         ENUM(
                      'Analista Fiscal',
                      'Analista Tributário',
                      'Coordenador Tributário',
                      'Coordenadora Tributária',
                      'Gerente Tributário',
                      'Head Tributário'
                    ) NULL,

  has_signature     BOOLEAN           NOT NULL DEFAULT FALSE COMMENT 'coluna "TEM ASSINATURA" (SIM/NÃO)',
  signature_file_path VARCHAR(255)    NULL COMMENT 'caminho da imagem de assinatura usada nos pareceres gerados',

  is_active         BOOLEAN           NOT NULL DEFAULT TRUE,
  last_login_at     DATETIME          NULL,

  created_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB;

-- Refresh tokens (JWT) — recomendado para autenticação stateless com logout/revogação
CREATE TABLE refresh_tokens (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id       BIGINT UNSIGNED NOT NULL,
  token_hash    VARCHAR(255)    NOT NULL COMMENT 'hash do refresh token, nunca o valor puro',
  expires_at    DATETIME        NOT NULL,
  revoked_at    DATETIME        NULL,
  created_at    TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_refresh_tokens_user
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  INDEX idx_refresh_tokens_user (user_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 2. CATÁLOGOS DE DOMÍNIO (dados mestres, praticamente estáticos)
-- =====================================================================

-- Tributos trabalhados pelo Grupo Studio
-- Origem: abas INICIO, Tabela ADM, Tabelas FINTAX, Resumo IR, etc.
CREATE TABLE taxes (
  id      TINYINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code    VARCHAR(20)  NOT NULL COMMENT 'PIS_COFINS | IRPJ_CSLL | INSS | IPI',
  name    VARCHAR(50)  NOT NULL,
  UNIQUE KEY uq_taxes_code (code)
) ENGINE=InnoDB;

INSERT INTO taxes (code, name) VALUES
  ('PIS_COFINS', 'PIS/COFINS'),
  ('IRPJ_CSLL',  'IRPJ/CSLL'),
  ('INSS',       'INSS'),
  ('IPI',        'IPI');

-- Catálogo mestre de "Pontos de Crédito"
-- Origem: aba INICIO (listas por tributo), "Resumo IR", "Resumo PIS e
-- COFINS", "Resumo de Créditos INSS", "Tabelas FINTAX" (verde/amarelo/vermelho)
CREATE TABLE credit_points (
  id              INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  tax_id          TINYINT UNSIGNED NOT NULL,
  name            VARCHAR(255)     NOT NULL COMMENT 'ex: "Aluguel De Prédios", "Subvenção para Investimentos"',

  -- ADM = ponto de crédito administrativo (linha da vida normal da empresa)
  -- FINTAX = tese/ponto qualificado, classificado por risco (verde/amarelo/vermelho)
  category        ENUM('ADM', 'FINTAX') NOT NULL DEFAULT 'ADM',
  risk_color      ENUM('VERDE', 'AMARELO', 'VERMELHO') NULL
                    COMMENT 'somente para category = FINTAX',

  legal_criteria  TEXT NULL COMMENT 'coluna "Critérios para apontarmos" / fundamentação legal',
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,

  created_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_credit_points_tax
    FOREIGN KEY (tax_id) REFERENCES taxes(id),
  UNIQUE KEY uq_credit_point_name (tax_id, name),
  INDEX idx_credit_points_category (category, risk_color)
) ENGINE=InnoDB;

-- =====================================================================
-- 3. CLIENTES E JOBS
-- Origem: aba INICIO (DADOS DO CLIENTE)
-- =====================================================================

CREATE TABLE clients (
  id                 BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cnpj               CHAR(14)      NOT NULL COMMENT 'somente dígitos, sem máscara',
  company_name       VARCHAR(255)  NOT NULL COMMENT 'CLIENTE / Razão Social',
  segment            VARCHAR(150)  NULL COMMENT 'SEGMENTO',
  tax_regime         ENUM('Lucro Real', 'Lucro Presumido', 'Simples Nacional', 'Lucro Arbitrado') NULL
                       COMMENT 'REGIME TRIBUTÁRIO (pode variar por Job/período)',

  created_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_clients_cnpj (cnpj)
) ENGINE=InnoDB;

CREATE TABLE jobs (
  id                     BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_number             VARCHAR(50)   NOT NULL COMMENT 'Nº JOB',
  client_id              BIGINT UNSIGNED NOT NULL,

  period_start           DATE NOT NULL COMMENT 'PERÍODO INICIAL',
  period_end             DATE NOT NULL COMMENT 'PERÍODO FINAL',
  tax_regime             ENUM('Lucro Real', 'Lucro Presumido', 'Simples Nacional', 'Lucro Arbitrado') NULL,
  segment                VARCHAR(150) NULL,

  status                 ENUM(
                           'diagnostico',
                           'em_analise',
                           'revisao',
                           'parecer_emitido',
                           'concluido',
                           'cancelado'
                         ) NOT NULL DEFAULT 'diagnostico',

  created_by             BIGINT UNSIGNED NULL,
  created_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_jobs_client
    FOREIGN KEY (client_id) REFERENCES clients(id),
  CONSTRAINT fk_jobs_created_by
    FOREIGN KEY (created_by) REFERENCES users(id),
  UNIQUE KEY uq_jobs_number (job_number),
  INDEX idx_jobs_client (client_id),
  INDEX idx_jobs_status (status)
) ENGINE=InnoDB;

-- Equipe responsável por cada Job (substitui as colunas fixas
-- GERENTE/COORDENADOR/ANALISTA da aba INICIO por um modelo flexível,
-- já contemplando também a "EQUIPE PREVIDENCIÁRIA" (linhas 74-78))
CREATE TABLE job_team_members (
  id            BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id        BIGINT UNSIGNED NOT NULL,
  user_id       BIGINT UNSIGNED NOT NULL,
  role_in_job   ENUM(
                  'responsavel_tecnico',
                  'gerente_tributario',
                  'coordenador_tributario',
                  'analista_fiscal',
                  'gerente_previdenciario',
                  'coordenador_previdenciario',
                  'analista_previdenciario'
                ) NOT NULL,

  CONSTRAINT fk_job_team_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_job_team_user
    FOREIGN KEY (user_id) REFERENCES users(id),
  UNIQUE KEY uq_job_role_user (job_id, role_in_job, user_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 4. DIAGNÓSTICO (questionário inicial do Job)
-- Origem: aba "Diagnóstico" (perguntas 1 a 8)
-- =====================================================================

CREATE TABLE job_diagnostics (
  id                             BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id                         BIGINT UNSIGNED NOT NULL,

  pays_darf                      BOOLEAN NULL COMMENT 'P1: empresa paga DARF?',

  avg_monthly_pis_cofins         DECIMAL(18,2) NULL,
  avg_yearly_pis_cofins          DECIMAL(18,2) NULL,
  avg_monthly_irpj_csll          DECIMAL(18,2) NULL,
  avg_yearly_irpj_csll           DECIMAL(18,2) NULL,
  avg_monthly_inss               DECIMAL(18,2) NULL,
  avg_yearly_inss                DECIMAL(18,2) NULL,
  avg_monthly_ipi                DECIMAL(18,2) NULL,
  avg_yearly_ipi                 DECIMAL(18,2) NULL,

  collection_method              TEXT NULL COMMENT 'P3: DARF, parcelamento, compensação, saldo credor...',
  opportunities_above_500k       BOOLEAN NULL COMMENT 'P4',
  already_credits_risk_point     BOOLEAN NULL COMMENT 'P5',
  has_debts_with_rfb             BOOLEAN NULL COMMENT 'P6: parcelamentos com a RFB',
  usage_plan                     TEXT NULL COMMENT 'P7: restituição, ressarcimento, escritural ou extemporâneo',
  estimated_usage_months         INT NULL COMMENT 'P8: tempo estimado de utilização em meses',

  observations                   TEXT NULL,

  created_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_job_diagnostics_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_job_diagnostics_job (job_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 5. ANÁLISE DE PONTOS DE CRÉDITO (o input principal dos operadores)
-- Origem: aba INICIO (colunas Ponto | OBSERVAÇÕES | Crédito, por tributo)
-- =====================================================================

CREATE TABLE job_credit_point_analyses (
  id                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id            BIGINT UNSIGNED NOT NULL,
  credit_point_id   INT UNSIGNED NOT NULL,

  has_credit        BOOLEAN NOT NULL DEFAULT FALSE COMMENT 'ponto identificado como aproveitável neste Job',
  observations      TEXT NULL COMMENT 'coluna OBSERVAÇÕES',

  -- total cacheado do ponto (idealmente = SUM(job_credit_monthly_values.value)
  -- para este job_credit_point_analysis_id); manter sincronizado via
  -- trigger ou na camada de serviço da API
  total_credit_value DECIMAL(18,2) NOT NULL DEFAULT 0,

  analyzed_by       BIGINT UNSIGNED NULL,
  analyzed_at       DATETIME NULL,

  created_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_jcpa_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_jcpa_credit_point
    FOREIGN KEY (credit_point_id) REFERENCES credit_points(id),
  CONSTRAINT fk_jcpa_analyzed_by
    FOREIGN KEY (analyzed_by) REFERENCES users(id),
  UNIQUE KEY uq_job_point (job_id, credit_point_id)
) ENGINE=InnoDB;

-- Série mensal de valores por ponto de crédito
-- Origem: aba CREDITOS (matriz mensal 01/2021 a 12/2026, separada por PIS/COFINS)
CREATE TABLE job_credit_monthly_values (
  id                                BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_credit_point_analysis_id      BIGINT UNSIGNED NOT NULL,

  contribution   ENUM('PIS', 'COFINS') NULL
                   COMMENT 'preenchido apenas quando o tributo do ponto é PIS/COFINS; NULL para os demais',
  reference_month DATE NOT NULL COMMENT 'sempre dia 01 do mês/ano de competência, ex: 2024-03-01',
  value           DECIMAL(18,2) NOT NULL DEFAULT 0,

  CONSTRAINT fk_jcmv_analysis
    FOREIGN KEY (job_credit_point_analysis_id) REFERENCES job_credit_point_analyses(id) ON DELETE CASCADE,
  UNIQUE KEY uq_jcmv_month (job_credit_point_analysis_id, contribution, reference_month)
) ENGINE=InnoDB;

-- =====================================================================
-- 6. UTILIZAÇÃO DE CRÉDITOS E RECEITAS MENSAIS
-- Origem: abas "UTILIZAÇÃO" e "% DE RECEITAS RET"
-- =====================================================================

CREATE TABLE job_credit_usages (
  id                          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id                      BIGINT UNSIGNED NOT NULL,
  reference_month             DATE NOT NULL COMMENT 'dia 01 do mês de competência',

  pis_credit                  DECIMAL(18,2) NOT NULL DEFAULT 0,
  darf_collected               DECIMAL(18,2) NOT NULL DEFAULT 0,
  month_excess                DECIMAL(18,2) NOT NULL DEFAULT 0,
  balance_to_update           DECIMAL(18,2) NOT NULL DEFAULT 0,
  excess_used                 DECIMAL(18,2) NOT NULL DEFAULT 0,
  restitution_update_value    DECIMAL(18,2) NOT NULL DEFAULT 0,
  pct_untaxed_outputs         DECIMAL(7,4)  NOT NULL DEFAULT 0,

  fintax_pis_credit           DECIMAL(18,2) NOT NULL DEFAULT 0,
  restitution_total           DECIMAL(18,2) NOT NULL DEFAULT 0,
  restitution_green           DECIMAL(18,2) NOT NULL DEFAULT 0,
  restitution_yellow          DECIMAL(18,2) NOT NULL DEFAULT 0,
  restitution_red             DECIMAL(18,2) NOT NULL DEFAULT 0,
  refund_total                DECIMAL(18,2) NOT NULL DEFAULT 0,
  refund_green                DECIMAL(18,2) NOT NULL DEFAULT 0,
  refund_yellow                DECIMAL(18,2) NOT NULL DEFAULT 0,
  refund_red                  DECIMAL(18,2) NOT NULL DEFAULT 0,
  bookkeeping_total           DECIMAL(18,2) NOT NULL DEFAULT 0,
  bookkeeping_green           DECIMAL(18,2) NOT NULL DEFAULT 0,
  bookkeeping_yellow          DECIMAL(18,2) NOT NULL DEFAULT 0,
  bookkeeping_red             DECIMAL(18,2) NOT NULL DEFAULT 0,

  CONSTRAINT fk_jcu_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_jcu_month (job_id, reference_month)
) ENGINE=InnoDB;

CREATE TABLE job_monthly_revenues (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id                BIGINT UNSIGNED NOT NULL,
  reference_month       DATE NOT NULL,

  taxed_revenue         DECIMAL(18,2) NOT NULL DEFAULT 0,
  untaxed_revenue       DECIMAL(18,2) NOT NULL DEFAULT 0,
  total_revenue         DECIMAL(18,2) GENERATED ALWAYS AS (taxed_revenue + untaxed_revenue) STORED,
  pct_untaxed_outputs   DECIMAL(7,4)  NOT NULL DEFAULT 0,

  CONSTRAINT fk_jmr_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_jmr_month (job_id, reference_month)
) ENGINE=InnoDB;

-- =====================================================================
-- 7. IMPORTAÇÕES DE ORIGEM FISCAL (DARF, SPED Contribuições, PER/DCOMP)
-- Origem: abas "DARF", "M400", "M610", "PERDCOMP"
-- =====================================================================

CREATE TABLE job_darf_entries (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id              BIGINT UNSIGNED NOT NULL,

  data_base           DATE NULL,
  darf_code           VARCHAR(20) NULL COMMENT 'coluna DARF',
  collection_date     DATE NULL COMMENT 'DATA_ARRECADACAO',
  due_date            DATE NULL COMMENT 'DATA_VENCIMENTO',
  assessment_period   VARCHAR(10) NULL COMMENT 'PERIODO_APURACAO, ex: 03/2024',
  revenue_code        VARCHAR(20) NULL COMMENT 'CODIGO_RECEITA',
  name                VARCHAR(255) NULL COMMENT 'NOME (descrição da receita)',
  document_number     VARCHAR(50) NULL COMMENT 'NUMERO_DOCUMENTO',
  total_value         DECIMAL(18,2) NOT NULL DEFAULT 0,
  days_late           INT NOT NULL DEFAULT 0,
  principal_value     DECIMAL(18,2) NOT NULL DEFAULT 0,
  fine_value          DECIMAL(18,2) NOT NULL DEFAULT 0,
  interest_value      DECIMAL(18,2) NOT NULL DEFAULT 0,
  tax_group           VARCHAR(50) NULL COMMENT 'GRUPO_TRIBUTO',
  cnpj                CHAR(14) NULL,

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_darf_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  INDEX idx_darf_job_period (job_id, assessment_period)
) ENGINE=InnoDB;

-- SPED Contribuições — Registro M400 (detalhamento de receitas com CST 04-09)
CREATE TABLE job_sped_m400_entries (
  id                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id                    BIGINT UNSIGNED NOT NULL,
  reference_month           DATE NOT NULL COMMENT 'ANO + MES',
  establishment             VARCHAR(100) NULL,
  reg                       VARCHAR(10) NULL COMMENT 'REG',
  cst                       VARCHAR(10) NULL COMMENT 'CÓDIGO DE SITUAÇÃO TRIBUTÁRIA',
  gross_revenue_value       DECIMAL(18,2) NOT NULL DEFAULT 0,
  accounting_account_code   VARCHAR(50) NULL,
  revenue_description       VARCHAR(255) NULL,
  bookkeeping_type          VARCHAR(50) NULL COMMENT 'TIPO_ESCRIT',
  data_base                 DATE NULL,

  created_at                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_m400_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  INDEX idx_m400_job_month (job_id, reference_month)
) ENGINE=InnoDB;

-- SPED Contribuições — Registro M610 (apuração da contribuição social - COFINS)
CREATE TABLE job_sped_m610_entries (
  id                                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id                              BIGINT UNSIGNED NOT NULL,
  reference_month                     DATE NOT NULL,
  establishment                       VARCHAR(100) NULL,
  contribution_code                   VARCHAR(20) NULL COMMENT 'COD_CONT',
  contribution_description            VARCHAR(255) NULL,
  gross_revenue_value                 DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'VL_REC_BRT',
  calculation_base_value              DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'VL_BC_CONT',
  pis_aliquot                         DECIMAL(9,4) NOT NULL DEFAULT 0 COMMENT 'ALIQ_PISA',
  pis_quantity                        DECIMAL(18,4) NOT NULL DEFAULT 0 COMMENT 'QUANT_BC_PIS',
  pis_quantity_aliquot                DECIMAL(9,4) NOT NULL DEFAULT 0 COMMENT 'ALIQ_PIS_QUANT',
  total_contribution_calculated       DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'VL_CONT_APUR',
  addition_adjustments_value          DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'VL_AJUS_ACRES',
  reduction_adjustments_value         DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'VL_AJUS_REDUC',
  deferred_contribution_value         DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'VL_CONT_DIFER',
  previous_deferred_contribution_value DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'VL_CONT_DIFER_ANT',
  total_period_contribution_value     DECIMAL(18,2) NOT NULL DEFAULT 0 COMMENT 'VL_CONT_PER',
  bookkeeping_type                    VARCHAR(50) NULL,
  data_base                           DATE NULL,

  created_at                          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT fk_m610_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  INDEX idx_m610_job_month (job_id, reference_month)
) ENGINE=InnoDB;

CREATE TABLE job_perdcomps (
  id                  BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id              BIGINT UNSIGNED NOT NULL,

  perdcomp_number     VARCHAR(50) NOT NULL,
  transmission_date   DATE NULL,
  credit_type         VARCHAR(100) NULL,
  document_type       VARCHAR(100) NULL,
  status              ENUM('EM_ANALISE', 'HOMOLOGADA', 'NAO_HOMOLOGADA', 'CANCELADA', 'RETIFICADA')
                        NOT NULL DEFAULT 'EM_ANALISE',

  created_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_perdcomp_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_perdcomp_number (perdcomp_number)
) ENGINE=InnoDB;

-- =====================================================================
-- 8. MÓDULO INSS (PREVIDENCIÁRIO)
-- Origem: aba "Observações Técnicas INSS"
-- =====================================================================

CREATE TABLE job_inss_technical_notes (
  id                                        BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id                                    BIGINT UNSIGNED NOT NULL,

  avg_monthly_social_security_debts         DECIMAL(18,2) NULL,
  avg_monthly_tax_debts                     DECIMAL(18,2) NULL,
  avg_employees_last_12_months              INT NULL,
  payroll_tax_relief_last_60_months         BOOLEAN NULL COMMENT 'desoneração da folha',
  simples_nacional_last_60_months           BOOLEAN NULL,
  dctfweb_mandatory                         BOOLEAN NULL,
  power_of_attorney_expiration              DATE NULL COMMENT 'vencimento da procuração eletrônica',
  has_esocial_dctfweb_perdcomp_access       BOOLEAN NULL,

  created_at                                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                                TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_inss_notes_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  UNIQUE KEY uq_inss_notes_job (job_id)
) ENGINE=InnoDB;

-- =====================================================================
-- 9. RELATÓRIOS / PARECERES TÉCNICOS
-- Origem: abas "PARECER NÃO CRÉDITO", "PARECER NÃO CRÉDITO IRCS",
-- "PARECER NÃO CRÉDITO IPI", "PARECER NÃO CRÉDITO INSS"
-- =====================================================================

CREATE TABLE job_reports (
  id                    BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id                BIGINT UNSIGNED NOT NULL,
  tax_id                TINYINT UNSIGNED NULL,

  report_type           ENUM('PARECER_CREDITO', 'PARECER_NAO_CREDITO') NOT NULL,
  conclusion_date        DATE NULL,
  responsible_user_id   BIGINT UNSIGNED NULL,
  file_path             VARCHAR(255) NULL COMMENT 'PDF/DOCX gerado',
  status                ENUM('rascunho', 'finalizado', 'assinado') NOT NULL DEFAULT 'rascunho',

  created_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at            TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  CONSTRAINT fk_reports_job
    FOREIGN KEY (job_id) REFERENCES jobs(id) ON DELETE CASCADE,
  CONSTRAINT fk_reports_tax
    FOREIGN KEY (tax_id) REFERENCES taxes(id),
  CONSTRAINT fk_reports_responsible
    FOREIGN KEY (responsible_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

SET FOREIGN_KEY_CHECKS = 1;