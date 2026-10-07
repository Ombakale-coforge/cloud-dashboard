import type { PrismaClient } from '@prisma/client';

export async function ensureAlertTablesExist(client: PrismaClient | any): Promise<void> {
  if (!client || typeof client.$executeRawUnsafe !== 'function') {
    return;
  }

  try {
    const ddl = `
IF OBJECT_ID('dbo.azure_cost_alerts', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[azure_cost_alerts] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [evaluation_date] CHAR(10) NOT NULL,
        [alert_type] NVARCHAR(64) NOT NULL,
        [severity] NVARCHAR(16) NOT NULL,
        [billing_currency] NVARCHAR(8) NOT NULL CONSTRAINT [DF_azure_cost_alerts_currency] DEFAULT ('INR'),
        [current_cost] DECIMAL(18,2) NOT NULL,
        [baseline_cost] DECIMAL(18,2) NULL,
        [absolute_increase] DECIMAL(18,2) NOT NULL,
        [percent_increase] DECIMAL(10,2) NULL,
        [non_zero_baseline_days] INT NULL,
        [subscription_id] NVARCHAR(100) NOT NULL,
        [subscription_name] NVARCHAR(255) NULL,
        [resource_id] NVARCHAR(300) NULL,
        [resource_name] NVARCHAR(255) NULL,
        [resource_group] NVARCHAR(255) NULL,
        [service] NVARCHAR(255) NULL,
        [first_seen_date] CHAR(10) NULL,
        [current_quantity] DECIMAL(24,6) NULL,
        [baseline_quantity] DECIMAL(24,6) NULL,
        [meter_id] NVARCHAR(100) NULL,
        [meter_name] NVARCHAR(255) NULL,
        [meter_category] NVARCHAR(255) NULL,
        [meter_sub_category] NVARCHAR(255) NULL,
        [unit_of_measure] NVARCHAR(64) NULL,
        [driver_annotation_json] NVARCHAR(MAX) NULL,
        [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_azure_cost_alerts_created_at] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_azure_cost_alerts] PRIMARY KEY CLUSTERED ([id])
    );
    CREATE NONCLUSTERED INDEX [azure_cost_alerts_date_idx] ON [dbo].[azure_cost_alerts]([evaluation_date]);
    CREATE NONCLUSTERED INDEX [azure_cost_alerts_type_idx] ON [dbo].[azure_cost_alerts]([alert_type]);
    CREATE NONCLUSTERED INDEX [azure_cost_alerts_severity_idx] ON [dbo].[azure_cost_alerts]([severity]);
END;

IF OBJECT_ID('dbo.azure_meter_budgets', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[azure_meter_budgets] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [meter_name] NVARCHAR(255) NOT NULL,
        [meter_category] NVARCHAR(255) NULL,
        [service] NVARCHAR(255) NULL,
        [monthly_budget] DECIMAL(18,2) NOT NULL,
        [billing_currency] NVARCHAR(8) NOT NULL CONSTRAINT [DF_azure_meter_budgets_currency] DEFAULT ('INR'),
        [alert_email] NVARCHAR(255) NOT NULL,
        [is_active] BIT NOT NULL CONSTRAINT [DF_azure_meter_budgets_active] DEFAULT 1,
        [last_notified_threshold] NVARCHAR(32) NULL,
        [last_notified_date] CHAR(10) NULL,
        [created_at] DATETIME2 NOT NULL CONSTRAINT [DF_azure_meter_budgets_created_at] DEFAULT SYSUTCDATETIME(),
        [updated_at] DATETIME2 NOT NULL CONSTRAINT [DF_azure_meter_budgets_updated_at] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_azure_meter_budgets] PRIMARY KEY CLUSTERED ([id])
    );
    CREATE NONCLUSTERED INDEX [azure_meter_budgets_meter_idx] ON [dbo].[azure_meter_budgets]([meter_name]);
END;

IF OBJECT_ID('dbo.azure_subscription_budgets', 'U') IS NULL
BEGIN
    CREATE TABLE [dbo].[azure_subscription_budgets] (
        [id] INT IDENTITY(1,1) NOT NULL,
        [subscription_id] NVARCHAR(100) NOT NULL,
        [subscription_name] NVARCHAR(255) NULL,
        [budget_name] NVARCHAR(255) NULL,
        [amount] DECIMAL(18,2) NULL,
        [time_grain] NVARCHAR(32) NOT NULL CONSTRAINT [DF_azure_sub_budgets_grain] DEFAULT ('Monthly'),
        [start_date] DATETIME2 NULL,
        [end_date] DATETIME2 NULL,
        [thresholds] NVARCHAR(512) NULL,
        [contact_emails] NVARCHAR(1024) NULL,
        [status] NVARCHAR(32) NOT NULL CONSTRAINT [DF_azure_sub_budgets_status] DEFAULT ('BUDGETED'),
        [error_message] NVARCHAR(1024) NULL,
        [last_synced_at] DATETIME2 NOT NULL CONSTRAINT [DF_azure_sub_budgets_synced] DEFAULT SYSUTCDATETIME(),
        CONSTRAINT [PK_azure_subscription_budgets] PRIMARY KEY CLUSTERED ([id])
    );
    CREATE UNIQUE NONCLUSTERED INDEX [azure_sub_budget_unique] ON [dbo].[azure_subscription_budgets]([subscription_id], [budget_name]);
    CREATE NONCLUSTERED INDEX [azure_sub_budget_sub_idx] ON [dbo].[azure_subscription_budgets]([subscription_id]);
END;
`;

    await client.$executeRawUnsafe(ddl);
  } catch (err: any) {
    console.warn('[DB] Table creation check warning:', err.message);
  }
}
