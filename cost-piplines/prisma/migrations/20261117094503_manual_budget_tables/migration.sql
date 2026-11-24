BEGIN TRY

BEGIN TRAN;

-- CreateTable
CREATE TABLE [dbo].[cloud_account_budgets] (
    [id] INT NOT NULL IDENTITY(1,1),
    [cloud_provider] NVARCHAR(16) NOT NULL,
    [account_id] NVARCHAR(128) NOT NULL,
    [account_name] NVARCHAR(255) NOT NULL,
    [parent_account_id] NVARCHAR(128),
    [monthly_budget] DECIMAL(18,2) NOT NULL,
    [billing_currency] NVARCHAR(8) NOT NULL CONSTRAINT [cloud_account_budgets_billing_currency_df] DEFAULT 'USD',
    [alert_email] NVARCHAR(512) NOT NULL,
    [contact_name] NVARCHAR(255),
    [is_active] BIT NOT NULL CONSTRAINT [cloud_account_budgets_is_active_df] DEFAULT 1,
    [last_notified_threshold] NVARCHAR(32),
    [last_notified_month] CHAR(7),
    [last_notified_at] DATETIME2,
    [last_manual_email_at] DATETIME2,
    [created_at] DATETIME2 NOT NULL CONSTRAINT [cloud_account_budgets_created_at_df] DEFAULT CURRENT_TIMESTAMP,
    [updated_at] DATETIME2 NOT NULL CONSTRAINT [cloud_account_budgets_updated_at_df] DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT [cloud_account_budgets_pkey] PRIMARY KEY CLUSTERED ([id]),
    CONSTRAINT [cloud_account_budgets_unique] UNIQUE NONCLUSTERED ([cloud_provider],[account_id])
);

-- CreateIndex
CREATE NONCLUSTERED INDEX [cloud_account_budgets_provider_idx] ON [dbo].[cloud_account_budgets]([cloud_provider]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
