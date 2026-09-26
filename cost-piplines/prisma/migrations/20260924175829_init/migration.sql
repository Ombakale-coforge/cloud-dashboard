BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[ingestion_runs] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [period] NVARCHAR(64) NOT NULL,
    [run_id] NVARCHAR(191) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [ingestion_runs_status_df] DEFAULT 'started',
    [error_message] NVARCHAR(1024),
    [ingested_at] DATETIME2 NOT NULL CONSTRAINT [ingestion_runs_ingested_at_df] DEFAULT CURRENT_TIMESTAMP,
    [rows_parsed] INT NOT NULL CONSTRAINT [ingestion_runs_rows_parsed_df] DEFAULT 0,
    [rows_written] INT NOT NULL CONSTRAINT [ingestion_runs_rows_written_df] DEFAULT 0,
    [duplicates_flagged] INT NOT NULL CONSTRAINT [ingestion_runs_duplicates_flagged_df] DEFAULT 0,
    [supersedes_flagged] INT NOT NULL CONSTRAINT [ingestion_runs_supersedes_flagged_df] DEFAULT 0,
    CONSTRAINT [ingestion_runs_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [ingestion_runs_period_run_unique] UNIQUE NONCLUSTERED ([period],[run_id])
);

-- CreateTable
CREATE TABLE [dbo].[usage_records] (
    [id] BIGINT NOT NULL IDENTITY(1,1),
    [stable_row_hash] CHAR(64) NOT NULL,
    [charge_key_hash] CHAR(64) NOT NULL,
    [is_duplicate_of_earlier_row] BIT NOT NULL CONSTRAINT [usage_records_is_duplicate_of_earlier_row_df] DEFAULT 0,
    [is_superseded_by_later_row] BIT NOT NULL CONSTRAINT [usage_records_is_superseded_by_later_row_df] DEFAULT 0,
    [usage_date] DATE NOT NULL,
    [usage_month] CHAR(7) NOT NULL,
    [charge_period_start] DATETIME2,
    [charge_period_end] DATETIME2,
    [subscription_id] NVARCHAR(191) NOT NULL,
    [subscription_name] NVARCHAR(255),
    [resource_id] NVARCHAR(300),
    [resource_id_hash] CHAR(64),
    [resource_name] NVARCHAR(255),
    [resource_group] NVARCHAR(255),
    [service] NVARCHAR(255) NOT NULL,
    [meter_id] NVARCHAR(191),
    [meter_name] NVARCHAR(255),
    [meter_category] NVARCHAR(255),
    [meter_sub_category] NVARCHAR(255),
    [consumed_quantity] DECIMAL(24,6),
    [consumed_unit] NVARCHAR(64),
    [pricing_quantity] DECIMAL(24,6),
    [pricing_unit] NVARCHAR(64),
    [billed_cost] DECIMAL(18,6) NOT NULL,
    [effective_cost] DECIMAL(18,6) NOT NULL,
    [billing_currency] NVARCHAR(8) NOT NULL CONSTRAINT [usage_records_billing_currency_df] DEFAULT 'INR',
    [charge_type] NVARCHAR(64),
    [charge_class] NVARCHAR(32),
    [region] NVARCHAR(128),
    [pricing_model] NVARCHAR(64),
    [is_credit_eligible] BIT,
    [tags] NVARCHAR(max),
    [tags_raw] NVARCHAR(2048),
    [is_excluded_from_alerts] BIT NOT NULL CONSTRAINT [usage_records_is_excluded_from_alerts_df] DEFAULT 0,
    [ingestion_run_id] BIGINT,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [usage_records_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [usage_records_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_runs] (
    [id] INT NOT NULL IDENTITY(1,1),
    [run_stamp] NVARCHAR(32) NOT NULL,
    [status] NVARCHAR(16) NOT NULL CONSTRAINT [report_runs_status_df] DEFAULT 'started',
    [started_at] DATETIME2 NOT NULL CONSTRAINT [report_runs_started_at_df] DEFAULT CURRENT_TIMESTAMP,
    [completed_at] DATETIME2,
    [duration_ms] INT,
    [deduped_row_count] BIGINT,
    [months_covered] NVARCHAR(max),
    [anomaly_threshold_percent] DECIMAL(6,2),
    [anomaly_rolling_months] INT,
    [error_message] NVARCHAR(1024),
    [log_text] NVARCHAR(max),
    CONSTRAINT [report_runs_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_monthly_totals] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [total_cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_monthly_totals_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_kpis_by_month] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [total_cost] DECIMAL(18,2) NOT NULL,
    [top_subscription] NVARCHAR(255),
    [top_subscription_cost] DECIMAL(18,2),
    [top_service] NVARCHAR(255),
    [top_service_cost] DECIMAL(18,2),
    [subscriptions] INT NOT NULL CONSTRAINT [report_kpis_by_month_subscriptions_df] DEFAULT 0,
    [resource_groups] INT NOT NULL CONSTRAINT [report_kpis_by_month_resource_groups_df] DEFAULT 0,
    CONSTRAINT [report_kpis_by_month_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_by_subscription] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [subscription] NVARCHAR(255) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_by_subscription_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_by_resource_group] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [resource_group] NVARCHAR(255) NOT NULL,
    [subscription] NVARCHAR(255) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_by_resource_group_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_by_service] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [consumed_service] NVARCHAR(255) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_by_service_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_by_charge_type] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [charge_type] NVARCHAR(64) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_by_charge_type_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_by_region] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [region] NVARCHAR(128) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_by_region_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_by_pricing_model] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [pricing_model] NVARCHAR(64) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_by_pricing_model_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_credit_eligibility] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [credit_eligible] NVARCHAR(16) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_credit_eligibility_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_top_meters] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [meter] NVARCHAR(255) NOT NULL,
    [category] NVARCHAR(255) NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [resource_group] NVARCHAR(255) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_top_meters_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_mom_change] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [total_cost] DECIMAL(18,2) NOT NULL,
    [previous_month_cost] DECIMAL(18,2),
    [mom_percent_change] DECIMAL(10,2),
    CONSTRAINT [report_mom_change_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_cost_concentration_pareto] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [total_cost] DECIMAL(18,2) NOT NULL,
    [percent_of_total] DECIMAL(6,2) NOT NULL,
    [cumulative_percent] DECIMAL(6,2) NOT NULL,
    [rank] INT NOT NULL,
    CONSTRAINT [report_cost_concentration_pareto_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_anomaly_flags] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [total_cost] DECIMAL(18,2) NOT NULL,
    [rolling_avg] DECIMAL(18,2),
    [difference_percent] DECIMAL(10,2),
    [threshold_percent] DECIMAL(6,2) NOT NULL,
    [is_anomaly] BIT NOT NULL CONSTRAINT [report_anomaly_flags_is_anomaly_df] DEFAULT 0,
    CONSTRAINT [report_anomaly_flags_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_new_services_by_month] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [new_service] NVARCHAR(255) NOT NULL,
    CONSTRAINT [report_new_services_by_month_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_forecast_next_month] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [method] NVARCHAR(64) NOT NULL,
    [forecasted_total_cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_forecast_next_month_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_volatility] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [mean] DECIMAL(18,2) NOT NULL,
    [std_dev] DECIMAL(18,2) NOT NULL,
    [coefficient_of_variation_percent] DECIMAL(10,1) NOT NULL,
    CONSTRAINT [report_volatility_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[report_top_resources] (
    [id] INT NOT NULL IDENTITY(1,1),
    [report_run_id] INT NOT NULL,
    [month] CHAR(7) NOT NULL,
    [resource_name] NVARCHAR(255) NOT NULL,
    [resource_group] NVARCHAR(255) NOT NULL,
    [service] NVARCHAR(255) NOT NULL,
    [cost] DECIMAL(18,2) NOT NULL,
    CONSTRAINT [report_top_resources_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [ingestion_runs_period_idx] ON [dbo].[ingestion_runs]([period]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_stable_hash_idx] ON [dbo].[usage_records]([stable_row_hash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_charge_key_hash_idx] ON [dbo].[usage_records]([charge_key_hash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_date_sub_idx] ON [dbo].[usage_records]([usage_date], [subscription_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_date_service_idx] ON [dbo].[usage_records]([usage_date], [service]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_date_resource_idx] ON [dbo].[usage_records]([usage_date], [subscription_id], [resource_id_hash]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_date_meter_idx] ON [dbo].[usage_records]([usage_date], [subscription_id], [resource_id_hash], [meter_id], [consumed_unit]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_resource_seen_idx] ON [dbo].[usage_records]([resource_id_hash], [usage_date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_usage_month_idx] ON [dbo].[usage_records]([usage_month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [usage_records_ingestion_run_idx] ON [dbo].[usage_records]([ingestion_run_id]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_runs_run_stamp_idx] ON [dbo].[report_runs]([run_stamp]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_monthly_totals_month_idx] ON [dbo].[report_monthly_totals]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_kpis_by_month_month_idx] ON [dbo].[report_kpis_by_month]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_by_subscription_month_idx] ON [dbo].[report_by_subscription]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_by_resource_group_month_idx] ON [dbo].[report_by_resource_group]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_by_service_month_idx] ON [dbo].[report_by_service]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_by_charge_type_month_idx] ON [dbo].[report_by_charge_type]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_by_region_month_idx] ON [dbo].[report_by_region]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_by_pricing_model_month_idx] ON [dbo].[report_by_pricing_model]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_credit_eligibility_month_idx] ON [dbo].[report_credit_eligibility]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_top_meters_month_idx] ON [dbo].[report_top_meters]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_mom_change_month_idx] ON [dbo].[report_mom_change]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_anomaly_flags_month_idx] ON [dbo].[report_anomaly_flags]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_new_services_by_month_month_idx] ON [dbo].[report_new_services_by_month]([month]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [report_top_resources_month_idx] ON [dbo].[report_top_resources]([month]);

-- AddForeignKey
ALTER TABLE [dbo].[usage_records] ADD CONSTRAINT [usage_records_ingestion_run_id_fkey] FOREIGN KEY ([ingestion_run_id]) REFERENCES [dbo].[ingestion_runs]([id]) ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
