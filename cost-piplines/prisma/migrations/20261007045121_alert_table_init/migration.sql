BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[azure_cost_alerts] (
    [id] INT NOT NULL IDENTITY(1,1),
    [evaluation_date] CHAR(10) NOT NULL,
    [alert_type] NVARCHAR(64) NOT NULL,
    [severity] NVARCHAR(16) NOT NULL,
    [billing_currency] NVARCHAR(8) NOT NULL CONSTRAINT [azure_cost_alerts_billing_currency_df] DEFAULT 'INR',
    [current_cost] DECIMAL(18,2) NOT NULL,
    [baseline_cost] DECIMAL(18,2),
    [absolute_increase] DECIMAL(18,2) NOT NULL,
    [percent_increase] DECIMAL(10,2),
    [non_zero_baseline_days] INT,
    [subscription_id] NVARCHAR(100) NOT NULL,
    [subscription_name] NVARCHAR(255),
    [resource_id] NVARCHAR(300),
    [resource_name] NVARCHAR(255),
    [resource_group] NVARCHAR(255),
    [service] NVARCHAR(255),
    [first_seen_date] CHAR(10),
    [current_quantity] DECIMAL(24,6),
    [baseline_quantity] DECIMAL(24,6),
    [meter_id] NVARCHAR(100),
    [meter_name] NVARCHAR(255),
    [meter_category] NVARCHAR(255),
    [meter_sub_category] NVARCHAR(255),
    [unit_of_measure] NVARCHAR(64),
    [driver_annotation_json] NVARCHAR(max),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [azure_cost_alerts_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [azure_cost_alerts_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateTable
CREATE TABLE [dbo].[azure_meter_budgets] (
    [id] INT NOT NULL IDENTITY(1,1),
    [meter_name] NVARCHAR(255) NOT NULL,
    [meter_category] NVARCHAR(255),
    [service] NVARCHAR(255),
    [monthly_budget] DECIMAL(18,2) NOT NULL,
    [billing_currency] NVARCHAR(8) NOT NULL CONSTRAINT [azure_meter_budgets_billing_currency_df] DEFAULT 'INR',
    [alert_email] NVARCHAR(255) NOT NULL,
    [is_active] BIT NOT NULL CONSTRAINT [azure_meter_budgets_is_active_df] DEFAULT 1,
    [last_notified_threshold] NVARCHAR(32),
    [last_notified_date] CHAR(10),
    [created_at] DATETIME2 NOT NULL CONSTRAINT [azure_meter_budgets_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [azure_meter_budgets_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [azure_meter_budgets_pkey] PRIMARY KEY CLUSTERED ([id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [azure_cost_alerts_date_idx] ON [dbo].[azure_cost_alerts]([evaluation_date]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [azure_cost_alerts_type_idx] ON [dbo].[azure_cost_alerts]([alert_type]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [azure_cost_alerts_severity_idx] ON [dbo].[azure_cost_alerts]([severity]);

-- CreateIndex
CREATE NONCLUSTERED INDEX [azure_meter_budgets_meter_idx] ON [dbo].[azure_meter_budgets]([meter_name]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
