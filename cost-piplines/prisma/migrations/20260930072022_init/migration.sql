BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[users] (
    [id] INT NOT NULL IDENTITY(1,1),
    [legacy_id] NVARCHAR(64),
    [name] NVARCHAR(255) NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    [password_hash] NVARCHAR(255) NOT NULL,
    [password_algo] NVARCHAR(32) NOT NULL CONSTRAINT [users_password_algo_df] DEFAULT 'bcrypt',
    [department] NVARCHAR(255),
    [role] NVARCHAR(16) NOT NULL CONSTRAINT [users_role_df] DEFAULT 'basic',
    [provider] NVARCHAR(32) NOT NULL CONSTRAINT [users_provider_df] DEFAULT 'credentials',
    [is_active] BIT NOT NULL CONSTRAINT [users_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [users_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [users_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    [last_login_at] DATETIME2,
    CONSTRAINT [users_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [users_legacy_id_unique] UNIQUE NONCLUSTERED ([legacy_id]),
    CONSTRAINT [users_email_unique] UNIQUE NONCLUSTERED ([email])
);

-- CreateTable
CREATE TABLE [dbo].[user_sessions] (
    [id] INT NOT NULL IDENTITY(1,1),
    [user_id] INT NOT NULL,
    [token_hash] CHAR(64) NOT NULL,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [user_sessions_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [expires_at] DATETIME2 NOT NULL,
    [revoked_at] DATETIME2,
    [ip_address] NVARCHAR(64),
    [user_agent] NVARCHAR(512),
    CONSTRAINT [user_sessions_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [user_sessions_token_hash_unique] UNIQUE NONCLUSTERED ([token_hash])
);

-- CreateTable
CREATE TABLE [dbo].[user_login_events] (
    [id] INT NOT NULL IDENTITY(1,1),
    [user_id] INT,
    [email_attempted] NVARCHAR(320) NOT NULL,
    [outcome] NVARCHAR(32) NOT NULL,
    [ip_address] NVARCHAR(64),
    [user_agent] NVARCHAR(512),
    [occurred_at] DATETIME2 NOT NULL CONSTRAINT [user_login_events_occurred_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [user_login_events_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[account_requests] (
    [id] INT NOT NULL IDENTITY(1,1),
    [legacy_id] NVARCHAR(64),
    [submitted_at] DATETIME2 NOT NULL CONSTRAINT [account_requests_submitted_at_df] DEFAULT CURRENT_TIMESTAMP,
    [submitted_by_user_id] INT,
    [submitter_email] NVARCHAR(320) NOT NULL,
    [submitter_name] NVARCHAR(255),
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [account_requests_status_df] DEFAULT 'pending',
    [admin_notes] NVARCHAR(max),
    [reviewed_by_user_id] INT,
    [reviewed_by_name] NVARCHAR(255),
    [reviewed_at] DATETIME2,
    [division] NVARCHAR(255) NOT NULL,
    [project_name] NVARCHAR(255) NOT NULL,
    [business_justification] NVARCHAR(max),
    [point_of_contact] NVARCHAR(320) NOT NULL,
    [account_manager] NVARCHAR(320) NOT NULL,
    [managed_by_coforge] BIT NOT NULL,
    [external_audience_access] BIT NOT NULL,
    [stores_customer_data] BIT NOT NULL,
    [customer_data_details] NVARCHAR(max),
    [stores_confidential_data] BIT NOT NULL,
    [estimated_monthly_cost] DECIMAL(18,2),
    [cost_charged_back] BIT NOT NULL,
    [foreseen_in_budget] BIT NOT NULL,
    [wbs_code] NVARCHAR(64),
    [cost_center] NVARCHAR(64),
    [aws_partnership_related] BIT NOT NULL,
    [bu_finance_controller] NVARCHAR(320),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [account_requests_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [account_requests_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [account_requests_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [account_requests_legacy_id_unique] UNIQUE NONCLUSTERED ([legacy_id])
);

-- CreateTable
CREATE TABLE [dbo].[account_request_environments] (
    [id] INT NOT NULL IDENTITY(1,1),
    [request_id] INT NOT NULL,
    [environment] NVARCHAR(32) NOT NULL,
    CONSTRAINT [account_request_environments_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [account_request_environments_unique] UNIQUE NONCLUSTERED ([request_id],[environment])
);

-- CreateTable
CREATE TABLE [dbo].[account_request_admin_emails] (
    [id] INT NOT NULL IDENTITY(1,1),
    [request_id] INT NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    CONSTRAINT [account_request_admin_emails_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [account_request_admin_emails_unique] UNIQUE NONCLUSTERED ([request_id],[email])
);

-- CreateTable
CREATE TABLE [dbo].[account_request_budget_alert_emails] (
    [id] INT NOT NULL IDENTITY(1,1),
    [request_id] INT NOT NULL,
    [email] NVARCHAR(320) NOT NULL,
    CONSTRAINT [account_request_budget_alert_emails_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [account_request_budget_alert_emails_unique] UNIQUE NONCLUSTERED ([request_id],[email])
);

-- CreateTable
CREATE TABLE [dbo].[account_request_status_history] (
    [id] INT NOT NULL IDENTITY(1,1),
    [request_id] INT NOT NULL,
    [from_status] NVARCHAR(16),
    [to_status] NVARCHAR(16) NOT NULL,
    [note] NVARCHAR(max),
    [changed_by_user_id] INT,
    [changed_by_name] NVARCHAR(255),
    [changed_at] DATETIME2 NOT NULL CONSTRAINT [account_request_status_history_changed_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [account_request_status_history_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[aws_accounts] (
    [id] INT NOT NULL IDENTITY(1,1),
    [config_id] NVARCHAR(32) NOT NULL,
    [name] NVARCHAR(255) NOT NULL,
    [aws_account_id] CHAR(12),
    [region] NVARCHAR(32),
    [is_primary] BIT NOT NULL CONSTRAINT [aws_accounts_is_primary_df] DEFAULT 0,
    [is_active] BIT NOT NULL CONSTRAINT [aws_accounts_is_active_df] DEFAULT 1,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [aws_accounts_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [aws_accounts_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [aws_accounts_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_accounts_config_id_unique] UNIQUE NONCLUSTERED ([config_id])
);

-- CreateTable
CREATE TABLE [dbo].[aws_linked_accounts] (
    [id] INT NOT NULL IDENTITY(1,1),
    [account_id] INT NOT NULL,
    [linked_account_id] CHAR(12) NOT NULL,
    [name] NVARCHAR(255),
    [status] NVARCHAR(32),
    [first_seen_at] DATETIME2 NOT NULL CONSTRAINT [aws_linked_accounts_first_seen_at_df] DEFAULT CURRENT_TIMESTAMP,
    [last_seen_at] DATETIME2 NOT NULL CONSTRAINT [aws_linked_accounts_last_seen_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [aws_linked_accounts_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_linked_accounts_unique] UNIQUE NONCLUSTERED ([account_id],[linked_account_id])
);

-- CreateTable
CREATE TABLE [dbo].[aws_report_runs] (
    [id] INT NOT NULL IDENTITY(1,1),
    [account_id] INT NOT NULL,
    [run_stamp] NVARCHAR(32) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [aws_report_runs_status_df] DEFAULT 'started',
    [started_at] DATETIME2 NOT NULL CONSTRAINT [aws_report_runs_started_at_df] DEFAULT CURRENT_TIMESTAMP,
    [completed_at] DATETIME2,
    [duration_ms] INT,
    [window_start] DATE,
    [window_end] DATE,
    [months_history] INT,
    [months_covered] NVARCHAR(max),
    [current_month] CHAR(7),
    [month_count] INT,
    [service_count] INT,
    [linked_account_count] INT,
    [budget_count] INT,
    [anomaly_sigma] DECIMAL(4,2),
    [anomaly_rolling_months] INT,
    [forecast_method] NVARCHAR(64),
    [error_message] NVARCHAR(1024),
    [log_text] NVARCHAR(max),
    CONSTRAINT [aws_report_runs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_report_runs_account_stamp_unique] UNIQUE NONCLUSTERED ([account_id],[run_stamp])
);

-- CreateTable
CREATE TABLE [dbo].[aws_report_run_steps] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [step_name] NVARCHAR(128) NOT NULL,
    [status] NVARCHAR(16) NOT NULL,
    [started_at] DATETIME2,
    [completed_at] DATETIME2,
    [rows_written] INT,
    [error_message] NVARCHAR(1024),
    CONSTRAINT [aws_report_run_steps_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[aws_monthly_totals] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [total_cost] DECIMAL(18,2) NOT NULL,
    [is_current_month] BIT NOT NULL CONSTRAINT [aws_monthly_totals_is_current_month_df] DEFAULT 0,
    CONSTRAINT [aws_monthly_totals_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_monthly_totals_run_month_unique] UNIQUE NONCLUSTERED ([report_run_id],[month])
);

-- CreateTable
CREATE TABLE [dbo].[aws_cost_by_service] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [aws_cost_by_service_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_cost_by_service_unique] UNIQUE NONCLUSTERED ([report_run_id],[month],[service])
);

-- CreateTable
CREATE TABLE [dbo].[aws_top_services] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [rank] INT NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [aws_top_services_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_top_services_run_rank_unique] UNIQUE NONCLUSTERED ([report_run_id],[rank])
);

-- CreateTable
CREATE TABLE [dbo].[aws_cost_by_linked_account] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [linked_account] NVARCHAR(255) NOT NULL,
    [month] CHAR(7) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [aws_cost_by_linked_account_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_cost_by_linked_account_unique] UNIQUE NONCLUSTERED ([report_run_id],[linked_account],[month])
);

-- CreateTable
CREATE TABLE [dbo].[aws_account_cost_variance] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [linked_account] NVARCHAR(255) NOT NULL,
    [prev_month_cost] DECIMAL(18,2) NOT NULL,
    [curr_month_cost] DECIMAL(18,2) NOT NULL,
    [difference] DECIMAL(18,2) NOT NULL,
    [percentage_change] DECIMAL(10,2) NOT NULL,
    CONSTRAINT [aws_account_cost_variance_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_account_cost_variance_unique] UNIQUE NONCLUSTERED ([report_run_id],[linked_account])
);

-- CreateTable
CREATE TABLE [dbo].[aws_mom_change] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [total_cost] DECIMAL(18,2) NOT NULL,
    [previous_month_cost] DECIMAL(18,2),
    [difference] DECIMAL(18,2),
    [mom_percent_change] DECIMAL(10,2),
    CONSTRAINT [aws_mom_change_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_mom_change_run_month_unique] UNIQUE NONCLUSTERED ([report_run_id],[month])
);

-- CreateTable
CREATE TABLE [dbo].[aws_pareto_analysis] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [rank] INT NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    [cumulative_cost] DECIMAL(18,2) NOT NULL,
    [cumulative_percent] DECIMAL(6,2) NOT NULL,
    [pareto_class] NVARCHAR(16) NOT NULL,
    CONSTRAINT [aws_pareto_analysis_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_pareto_analysis_run_rank_unique] UNIQUE NONCLUSTERED ([report_run_id],[rank])
);

-- CreateTable
CREATE TABLE [dbo].[aws_anomaly_flags] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [total_cost] DECIMAL(18,2) NOT NULL,
    [rolling_avg] DECIMAL(18,2),
    [rolling_std] DECIMAL(18,2),
    [anomaly_flag] NVARCHAR(48) NOT NULL,
    [is_anomaly] BIT NOT NULL CONSTRAINT [aws_anomaly_flags_is_anomaly_df] DEFAULT 0,
    CONSTRAINT [aws_anomaly_flags_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_anomaly_flags_run_month_unique] UNIQUE NONCLUSTERED ([report_run_id],[month])
);

-- CreateTable
CREATE TABLE [dbo].[aws_recurring_vs_onetime] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [active_months] INT NOT NULL,
    [total_months_in_run] INT NOT NULL,
    [active_percent] DECIMAL(6,2) NOT NULL,
    [total_cost_over_period] DECIMAL(18,2) NOT NULL,
    [classification] NVARCHAR(32) NOT NULL,
    CONSTRAINT [aws_recurring_vs_onetime_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_recurring_vs_onetime_unique] UNIQUE NONCLUSTERED ([report_run_id],[service])
);

-- CreateTable
CREATE TABLE [dbo].[aws_new_services_flag] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [cost_in_latest_month] DECIMAL(18,2) NOT NULL,
    [first_seen_month] CHAR(7) NOT NULL,
    [note] NVARCHAR(255),
    CONSTRAINT [aws_new_services_flag_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_new_services_flag_unique] UNIQUE NONCLUSTERED ([report_run_id],[service])
);

-- CreateTable
CREATE TABLE [dbo].[aws_category_monthly_costs] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [category] NVARCHAR(64) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    [share_percent] DECIMAL(6,2) NOT NULL,
    CONSTRAINT [aws_category_monthly_costs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_category_monthly_costs_unique] UNIQUE NONCLUSTERED ([report_run_id],[month],[category])
);

-- CreateTable
CREATE TABLE [dbo].[aws_forecast] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [forecast_month] CHAR(7) NOT NULL,
    [projected_cost] DECIMAL(18,2) NOT NULL,
    [method] NVARCHAR(64) NOT NULL,
    CONSTRAINT [aws_forecast_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_forecast_run_month_unique] UNIQUE NONCLUSTERED ([report_run_id],[forecast_month])
);

-- CreateTable
CREATE TABLE [dbo].[aws_service_volatility] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [mean] DECIMAL(18,2) NOT NULL,
    [std_dev] DECIMAL(18,2) NOT NULL,
    [coefficient_of_variation_percent] DECIMAL(10,2) NOT NULL,
    CONSTRAINT [aws_service_volatility_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_service_volatility_unique] UNIQUE NONCLUSTERED ([report_run_id],[service])
);

-- CreateTable
CREATE TABLE [dbo].[aws_budgets_overview] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [budget_name] NVARCHAR(255) NOT NULL,
    [limit_amount] DECIMAL(18,2) NOT NULL,
    [current_used] DECIMAL(18,2) NOT NULL,
    [forecasted_spend] DECIMAL(18,2) NOT NULL,
    [current_vs_budget_percent] DECIMAL(10,2) NOT NULL,
    [threshold_status] NVARCHAR(16) NOT NULL,
    [health_status] NVARCHAR(16) NOT NULL,
    CONSTRAINT [aws_budgets_overview_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[aws_unbudgeted_accounts] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [account_name] NVARCHAR(255) NOT NULL,
    [aws_account_id] CHAR(12) NOT NULL,
    [status] NVARCHAR(32) NOT NULL,
    [current_month_spend] DECIMAL(18,2) NOT NULL,
    [previous_month_spend] DECIMAL(18,2) NOT NULL,
    [mom_change_percent] DECIMAL(10,2) NOT NULL,
    [top_cost_driver] NVARCHAR(255),
    CONSTRAINT [aws_unbudgeted_accounts_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_unbudgeted_accounts_unique] UNIQUE NONCLUSTERED ([report_run_id],[aws_account_id])
);

-- CreateTable
CREATE TABLE [dbo].[aws_governance_summary] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [selected_month] CHAR(7) NOT NULL,
    [total_accounts] INT NOT NULL,
    [active_accounts] INT NOT NULL,
    [suspended_accounts] INT NOT NULL,
    [accounts_with_budget] INT NOT NULL,
    [accounts_with_no_budget] INT NOT NULL,
    [budget_coverage_pct] DECIMAL(6,2) NOT NULL,
    [active_spend_total] DECIMAL(18,2) NOT NULL,
    [spend_under_budget] DECIMAL(18,2) NOT NULL,
    [spend_with_no_budget] DECIMAL(18,2) NOT NULL,
    [share_spend_uncovered_pct] DECIMAL(6,2) NOT NULL,
    [sum_budget_limits] DECIMAL(18,2) NOT NULL,
    [suspended_accounts_charging_count] INT NOT NULL,
    [suspended_accounts_spend_total] DECIMAL(18,2) NOT NULL,
    [suspended_period_label] NVARCHAR(64),
    CONSTRAINT [aws_governance_summary_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [aws_governance_summary_run_unique] UNIQUE NONCLUSTERED ([report_run_id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [users_role_idx] ON [dbo].[users]([role]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_sessions_user_idx] ON [dbo].[user_sessions]([user_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_sessions_expires_idx] ON [dbo].[user_sessions]([expires_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_login_events_user_time_idx] ON [dbo].[user_login_events]([user_id], [occurred_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [user_login_events_email_time_idx] ON [dbo].[user_login_events]([email_attempted], [occurred_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [account_requests_status_submitted_idx] ON [dbo].[account_requests]([status], [submitted_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [account_requests_submitter_email_idx] ON [dbo].[account_requests]([submitter_email]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [account_requests_submitted_by_idx] ON [dbo].[account_requests]([submitted_by_user_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [account_request_status_history_request_time_idx] ON [dbo].[account_request_status_history]([request_id], [changed_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_linked_accounts_name_idx] ON [dbo].[aws_linked_accounts]([name]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_report_runs_run_stamp_idx] ON [dbo].[aws_report_runs]([run_stamp]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_report_runs_latest_idx] ON [dbo].[aws_report_runs]([account_id], [status], [completed_at]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_report_run_steps_run_idx] ON [dbo].[aws_report_run_steps]([report_run_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_monthly_totals_month_idx] ON [dbo].[aws_monthly_totals]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_cost_by_service_run_service_idx] ON [dbo].[aws_cost_by_service]([report_run_id], [service]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_cost_by_service_month_idx] ON [dbo].[aws_cost_by_service]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_cost_by_linked_account_month_idx] ON [dbo].[aws_cost_by_linked_account]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_mom_change_month_idx] ON [dbo].[aws_mom_change]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_anomaly_flags_month_idx] ON [dbo].[aws_anomaly_flags]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_category_monthly_costs_month_idx] ON [dbo].[aws_category_monthly_costs]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [aws_budgets_overview_run_idx] ON [dbo].[aws_budgets_overview]([report_run_id]);

-- AddForeignKey
ALTER TABLE [dbo].[user_sessions] ADD CONSTRAINT [user_sessions_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[user_login_events] ADD CONSTRAINT [user_login_events_user_id_fkey] FOREIGN KEY ([user_id]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[account_requests] ADD CONSTRAINT [account_requests_submitted_by_user_id_fkey] FOREIGN KEY ([submitted_by_user_id]) REFERENCES [dbo].[users]([id]) ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[account_requests] ADD CONSTRAINT [account_requests_reviewed_by_user_id_fkey] FOREIGN KEY ([reviewed_by_user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[account_request_environments] ADD CONSTRAINT [account_request_environments_request_id_fkey] FOREIGN KEY ([request_id]) REFERENCES [dbo].[account_requests]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[account_request_admin_emails] ADD CONSTRAINT [account_request_admin_emails_request_id_fkey] FOREIGN KEY ([request_id]) REFERENCES [dbo].[account_requests]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[account_request_budget_alert_emails] ADD CONSTRAINT [account_request_budget_alert_emails_request_id_fkey] FOREIGN KEY ([request_id]) REFERENCES [dbo].[account_requests]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[account_request_status_history] ADD CONSTRAINT [account_request_status_history_request_id_fkey] FOREIGN KEY ([request_id]) REFERENCES [dbo].[account_requests]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[account_request_status_history] ADD CONSTRAINT [account_request_status_history_changed_by_user_id_fkey] FOREIGN KEY ([changed_by_user_id]) REFERENCES [dbo].[users]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[aws_linked_accounts] ADD CONSTRAINT [aws_linked_accounts_account_id_fkey] FOREIGN KEY ([account_id]) REFERENCES [dbo].[aws_accounts]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_report_runs] ADD CONSTRAINT [aws_report_runs_account_id_fkey] FOREIGN KEY ([account_id]) REFERENCES [dbo].[aws_accounts]([id]) ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE [dbo].[aws_report_run_steps] ADD CONSTRAINT [aws_report_run_steps_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_monthly_totals] ADD CONSTRAINT [aws_monthly_totals_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_cost_by_service] ADD CONSTRAINT [aws_cost_by_service_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_top_services] ADD CONSTRAINT [aws_top_services_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_cost_by_linked_account] ADD CONSTRAINT [aws_cost_by_linked_account_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_account_cost_variance] ADD CONSTRAINT [aws_account_cost_variance_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_mom_change] ADD CONSTRAINT [aws_mom_change_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_pareto_analysis] ADD CONSTRAINT [aws_pareto_analysis_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_anomaly_flags] ADD CONSTRAINT [aws_anomaly_flags_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_recurring_vs_onetime] ADD CONSTRAINT [aws_recurring_vs_onetime_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_new_services_flag] ADD CONSTRAINT [aws_new_services_flag_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_category_monthly_costs] ADD CONSTRAINT [aws_category_monthly_costs_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_forecast] ADD CONSTRAINT [aws_forecast_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_service_volatility] ADD CONSTRAINT [aws_service_volatility_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_budgets_overview] ADD CONSTRAINT [aws_budgets_overview_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_unbudgeted_accounts] ADD CONSTRAINT [aws_unbudgeted_accounts_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE [dbo].[aws_governance_summary] ADD CONSTRAINT [aws_governance_summary_report_run_id_fkey] FOREIGN KEY ([report_run_id]) REFERENCES [dbo].[aws_report_runs]([id]) ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
