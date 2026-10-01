BEGIN TRY

BEGIN TRAN;

-- CreateIndex
CREATE NONCLUSTERED INDEX [azure_usage_records_active_alerts_idx] ON [dbo].[azure_usage_records]([is_duplicate_of_earlier_row], [is_superseded_by_later_row], [is_excluded_from_alerts], [usage_date]);

COMMIT TRAN;

END TRY
BEGIN CATCH

IF @@TRANCOUNT > 0
BEGIN
    ROLLBACK TRAN;
END;
THROW

END CATCH
