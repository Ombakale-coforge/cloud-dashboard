/**
 * src/db/aws_repository.js
 * 
 * Direct SQL Server persistence layer for AWS pipeline runs.
 * Ingests in-memory computed data into all AWS tables in a single transaction per run.
 */

const { getPool, sql } = require("./pool");

/**
 * Inserts rows in batches using parameterized multi-row VALUES clauses.
 */
async function batchInsert(transaction, tableName, columns, rows) {
  if (!rows || rows.length === 0) return 0;

  const colNames = Object.keys(columns);
  const maxParams = 2000;
  const batchSize = Math.max(1, Math.floor(maxParams / colNames.length));

  for (let i = 0; i < rows.length; i += batchSize) {
    const chunk = rows.slice(i, i + batchSize);
    const request = new sql.Request(transaction);
    const valueClauses = [];

    chunk.forEach((row, rowIdx) => {
      const paramNames = [];
      colNames.forEach((col) => {
        const paramName = `${col}_${rowIdx}`;
        paramNames.push(`@${paramName}`);
        const type = columns[col];
        const val = row[col];

        if (val === null || val === undefined) {
          request.input(paramName, type, null);
        } else {
          request.input(paramName, type, val);
        }
      });
      valueClauses.push(`(${paramNames.join(", ")})`);
    });

    const query = `
      INSERT INTO [${tableName}] (${colNames.map((c) => `[${c}]`).join(", ")})
      VALUES ${valueClauses.join(", ")}
    `;

    await request.query(query);
  }

  return rows.length;
}

/**
 * Upserts the AwsAccount row in aws_accounts.
 */
async function upsertAwsAccount(transaction, accountConfig) {
  const request = new sql.Request(transaction);
  request.input("configId", sql.NVarChar(32), accountConfig.id);
  request.input("name", sql.NVarChar(255), accountConfig.name);
  request.input("region", sql.NVarChar(32), accountConfig.region || "us-east-1");
  request.input("isPrimary", sql.Bit, accountConfig.isPrimary ? 1 : 0);

  const numericMatch = accountConfig.name.match(/\d{4}-?\d{4}-?\d{4}/) || accountConfig.name.match(/\d{12}/);
  const awsAccountId = numericMatch ? numericMatch[0].replace(/[^0-9]/g, "") : null;
  request.input("awsAccountId", sql.Char(12), awsAccountId);

  const query = `
    MERGE INTO [aws_accounts] AS target
    USING (SELECT @configId AS config_id) AS source
    ON (target.config_id = source.config_id)
    WHEN MATCHED THEN
      UPDATE SET 
        name = @name,
        aws_account_id = COALESCE(@awsAccountId, target.aws_account_id),
        region = @region,
        is_primary = @isPrimary,
        is_active = 1,
        updated_at = SYSDATETIME()
    WHEN NOT MATCHED THEN
      INSERT (config_id, name, aws_account_id, region, is_primary, is_active, created_at, updated_at)
      VALUES (@configId, @name, @awsAccountId, @region, @isPrimary, 1, SYSDATETIME(), SYSDATETIME())
    OUTPUT inserted.id;
  `;

  const result = await request.query(query);
  return result.recordset[0].id;
}

/**
 * Upserts directory of linked accounts seen under this payer.
 */
async function upsertLinkedAccounts(transaction, dbAccountId, linkedAccountsList) {
  if (!linkedAccountsList || linkedAccountsList.length === 0) return;

  for (const la of linkedAccountsList) {
    const request = new sql.Request(transaction);
    request.input("accountId", sql.Int, dbAccountId);
    request.input("linkedAccountId", sql.Char(12), la.Id.replace(/[^0-9]/g, ""));
    request.input("name", sql.NVarChar(255), la.Name || null);
    request.input("status", sql.NVarChar(32), la.Status || "ACTIVE");

    const query = `
      MERGE INTO [aws_linked_accounts] AS target
      USING (SELECT @accountId AS account_id, @linkedAccountId AS linked_account_id) AS source
      ON (target.account_id = source.account_id AND target.linked_account_id = source.linked_account_id)
      WHEN MATCHED THEN
        UPDATE SET 
          name = @name,
          status = @status,
          last_seen_at = SYSDATETIME()
      WHEN NOT MATCHED THEN
        INSERT (account_id, linked_account_id, name, status, first_seen_at, last_seen_at)
        VALUES (@accountId, @linkedAccountId, @name, @status, SYSDATETIME(), SYSDATETIME());
    `;
    await request.query(query);
  }
}

/**
 * Creates an AwsReportRun record and returns its ID.
 */
async function createReportRun(transaction, dbAccountId, runData) {
  const request = new sql.Request(transaction);
  request.input("accountId", sql.Int, dbAccountId);
  request.input("runStamp", sql.NVarChar(32), runData.runStamp);
  request.input("status", sql.NVarChar(16), "started");
  request.input("windowStart", sql.Date, runData.windowStart ? new Date(runData.windowStart) : null);
  request.input("windowEnd", sql.Date, runData.windowEnd ? new Date(runData.windowEnd) : null);
  request.input("monthsHistory", sql.Int, runData.monthsHistory || 6);
  request.input("monthsCovered", sql.NVarChar(sql.MAX), JSON.stringify(runData.monthsCovered || []));
  request.input("currentMonth", sql.Char(7), runData.currentMonth || null);
  request.input("monthCount", sql.Int, runData.monthsCovered?.length || 0);
  request.input("serviceCount", sql.Int, runData.serviceCount || 0);
  request.input("linkedAccountCount", sql.Int, runData.linkedAccountCount || 0);
  request.input("budgetCount", sql.Int, runData.budgets?.length || 0);
  request.input("forecastMethod", sql.NVarChar(64), "Linear trend on completed months");

  const query = `
    INSERT INTO [aws_report_runs] (
      account_id, run_stamp, status, started_at, window_start, window_end,
      months_history, months_covered, current_month, month_count,
      service_count, linked_account_count, budget_count, forecast_method
    )
    OUTPUT inserted.id
    VALUES (
      @accountId, @runStamp, @status, SYSDATETIME(), @windowStart, @windowEnd,
      @monthsHistory, @monthsCovered, @currentMonth, @monthCount,
      @serviceCount, @linkedAccountCount, @budgetCount, @forecastMethod
    );
  `;

  const result = await request.query(query);
  return result.recordset[0].id;
}

/**
 * Updates report run with final success status and execution duration.
 */
async function completeReportRun(transaction, reportRunId, durationMs, logText) {
  const request = new sql.Request(transaction);
  request.input("id", sql.Int, reportRunId);
  request.input("durationMs", sql.Int, durationMs);
  request.input("logText", sql.NVarChar(sql.MAX), logText || null);

  const query = `
    UPDATE [aws_report_runs]
    SET 
      status = 'success',
      completed_at = SYSDATETIME(),
      duration_ms = @durationMs,
      log_text = @logText
    WHERE id = @id;
  `;

  await request.query(query);
}

/**
 * Main entry point to persist a full AWS run directly to SQL Server.
 */
async function saveAwsReportRunToDatabase(accountConfig, runData, log) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  const startedAt = Date.now();
  log(`Starting direct SQL Server ingestion for account "${accountConfig.name}" (run: ${runData.runStamp})...`);

  try {
    // 1. Ensure Account Exists
    const dbAccountId = await upsertAwsAccount(transaction, accountConfig);

    // 2. Upsert Linked Accounts Catalog (if any)
    if (runData.linkedAccountsCatalog && runData.linkedAccountsCatalog.length > 0) {
      await upsertLinkedAccounts(transaction, dbAccountId, runData.linkedAccountsCatalog);
    }

    // 3. Create Report Run Record
    const reportRunId = await createReportRun(transaction, dbAccountId, runData);
    log(`Created aws_report_runs record (ID: ${reportRunId})`);

    // 4. Ingest monthly totals
    if (runData.monthlyTotals && runData.monthlyTotals.length > 0) {
      const rows = runData.monthlyTotals.map((m) => ({
        report_run_id: reportRunId,
        month: m.month,
        total_cost: m.totalCost,
        is_current_month: m.isCurrentMonth ? 1 : 0,
      }));
      await batchInsert(transaction, "aws_monthly_totals", {
        report_run_id: sql.Int,
        month: sql.Char(7),
        total_cost: sql.Decimal(18, 2),
        is_current_month: sql.Bit,
      }, rows);
    }

    // 5. Ingest cost by service (unpivoted)
    if (runData.costByService && runData.costByService.length > 0) {
      const rows = runData.costByService.map((s) => ({
        report_run_id: reportRunId,
        month: s.month,
        service: s.service,
        cost: s.cost,
      }));
      await batchInsert(transaction, "aws_cost_by_service", {
        report_run_id: sql.Int,
        month: sql.Char(7),
        service: sql.NVarChar(255),
        cost: sql.Decimal(18, 2),
      }, rows);
    }

    // 6. Ingest top 10 services
    if (runData.topServices && runData.topServices.length > 0) {
      const rows = runData.topServices.map((t, idx) => ({
        report_run_id: reportRunId,
        month: t.month || runData.currentMonth,
        rank: t.rank || idx + 1,
        service: t.service,
        cost: t.cost,
      }));
      await batchInsert(transaction, "aws_top_services", {
        report_run_id: sql.Int,
        month: sql.Char(7),
        rank: sql.Int,
        service: sql.NVarChar(255),
        cost: sql.Decimal(18, 2),
      }, rows);
    }

    // 7. Ingest cost by linked account (unpivoted)
    if (runData.costByLinkedAccount && runData.costByLinkedAccount.length > 0) {
      const rows = runData.costByLinkedAccount.map((la) => ({
        report_run_id: reportRunId,
        linked_account: la.linkedAccount,
        month: la.month,
        cost: la.cost,
      }));
      await batchInsert(transaction, "aws_cost_by_linked_account", {
        report_run_id: sql.Int,
        linked_account: sql.NVarChar(255),
        month: sql.Char(7),
        cost: sql.Decimal(18, 2),
      }, rows);
    }

    // 8. Ingest account cost variance
    if (runData.accountCostVariance && runData.accountCostVariance.length > 0) {
      const rows = runData.accountCostVariance.map((v) => ({
        report_run_id: reportRunId,
        linked_account: v.linkedAccount,
        prev_month_cost: v.prevMonthCost,
        curr_month_cost: v.currMonthCost,
        difference: v.difference,
        percentage_change: v.percentageChange,
      }));
      await batchInsert(transaction, "aws_account_cost_variance", {
        report_run_id: sql.Int,
        linked_account: sql.NVarChar(255),
        prev_month_cost: sql.Decimal(18, 2),
        curr_month_cost: sql.Decimal(18, 2),
        difference: sql.Decimal(18, 2),
        percentage_change: sql.Decimal(10, 2),
      }, rows);
    }

    // 9. Ingest MoM change
    if (runData.momChange && runData.momChange.length > 0) {
      const rows = runData.momChange.map((m) => ({
        report_run_id: reportRunId,
        month: m.month,
        total_cost: m.totalCost,
        previous_month_cost: m.previousMonthCost ?? null,
        difference: m.difference ?? null,
        mom_percent_change: m.momPercentChange ?? null,
      }));
      await batchInsert(transaction, "aws_mom_change", {
        report_run_id: sql.Int,
        month: sql.Char(7),
        total_cost: sql.Decimal(18, 2),
        previous_month_cost: sql.Decimal(18, 2),
        difference: sql.Decimal(18, 2),
        mom_percent_change: sql.Decimal(10, 2),
      }, rows);
    }

    // 10. Ingest Pareto analysis
    if (runData.pareto && runData.pareto.length > 0) {
      const rows = runData.pareto.map((p, idx) => ({
        report_run_id: reportRunId,
        month: p.month || runData.currentMonth,
        rank: p.rank || idx + 1,
        service: p.service,
        cost: p.cost,
        cumulative_cost: p.cumulativeCost,
        cumulative_percent: p.cumulativePercent,
        pareto_class: p.paretoClass,
      }));
      await batchInsert(transaction, "aws_pareto_analysis", {
        report_run_id: sql.Int,
        month: sql.Char(7),
        rank: sql.Int,
        service: sql.NVarChar(255),
        cost: sql.Decimal(18, 2),
        cumulative_cost: sql.Decimal(18, 2),
        cumulative_percent: sql.Decimal(6, 2),
        pareto_class: sql.NVarChar(16),
      }, rows);
    }

    // 11. Ingest anomaly flags
    if (runData.anomalyFlags && runData.anomalyFlags.length > 0) {
      const rows = runData.anomalyFlags.map((a) => ({
        report_run_id: reportRunId,
        month: a.month,
        total_cost: a.totalCost,
        rolling_avg: a.rollingAvg ?? null,
        rolling_std: a.rollingStd ?? null,
        anomaly_flag: a.anomalyFlag,
        is_anomaly: a.isAnomaly ? 1 : 0,
      }));
      await batchInsert(transaction, "aws_anomaly_flags", {
        report_run_id: sql.Int,
        month: sql.Char(7),
        total_cost: sql.Decimal(18, 2),
        rolling_avg: sql.Decimal(18, 2),
        rolling_std: sql.Decimal(18, 2),
        anomaly_flag: sql.NVarChar(48),
        is_anomaly: sql.Bit,
      }, rows);
    }

    // 12. Ingest recurring vs onetime
    if (runData.recurringVsOnetime && runData.recurringVsOnetime.length > 0) {
      const rows = runData.recurringVsOnetime.map((r) => ({
        report_run_id: reportRunId,
        service: r.service,
        active_months: r.activeMonths,
        total_months_in_run: r.totalMonthsInRun,
        active_percent: r.activePercent,
        total_cost_over_period: r.totalCostOverPeriod,
        classification: r.classification,
      }));
      await batchInsert(transaction, "aws_recurring_vs_onetime", {
        report_run_id: sql.Int,
        service: sql.NVarChar(255),
        active_months: sql.Int,
        total_months_in_run: sql.Int,
        active_percent: sql.Decimal(6, 2),
        total_cost_over_period: sql.Decimal(18, 2),
        classification: sql.NVarChar(32),
      }, rows);
    }

    // 13. Ingest new services
    if (runData.newServices && runData.newServices.length > 0) {
      const rows = runData.newServices.map((n) => ({
        report_run_id: reportRunId,
        service: n.service,
        cost_in_latest_month: n.costInLatestMonth,
        first_seen_month: n.firstSeenMonth,
        note: n.note ?? null,
      }));
      await batchInsert(transaction, "aws_new_services_flag", {
        report_run_id: sql.Int,
        service: sql.NVarChar(255),
        cost_in_latest_month: sql.Decimal(18, 2),
        first_seen_month: sql.Char(7),
        note: sql.NVarChar(255),
      }, rows);
    }

    // 14. Ingest category monthly costs
    if (runData.categoryMonthlyCosts && runData.categoryMonthlyCosts.length > 0) {
      const rows = runData.categoryMonthlyCosts.map((c) => ({
        report_run_id: reportRunId,
        month: c.month,
        category: c.category,
        cost: c.cost,
        share_percent: c.sharePercent,
      }));
      await batchInsert(transaction, "aws_category_monthly_costs", {
        report_run_id: sql.Int,
        month: sql.Char(7),
        category: sql.NVarChar(64),
        cost: sql.Decimal(18, 2),
        share_percent: sql.Decimal(6, 2),
      }, rows);
    }

    // 15. Ingest forecasts
    if (runData.forecasts && runData.forecasts.length > 0) {
      const rows = runData.forecasts.map((f) => ({
        report_run_id: reportRunId,
        forecast_month: f.forecastMonth,
        projected_cost: f.projectedCost,
        method: f.method,
      }));
      await batchInsert(transaction, "aws_forecast", {
        report_run_id: sql.Int,
        forecast_month: sql.Char(7),
        projected_cost: sql.Decimal(18, 2),
        method: sql.NVarChar(64),
      }, rows);
    }

    // 16. Ingest service volatility
    if (runData.serviceVolatility && runData.serviceVolatility.length > 0) {
      const rows = runData.serviceVolatility.map((v) => ({
        report_run_id: reportRunId,
        service: v.service,
        mean: v.mean,
        std_dev: v.stdDev,
        coefficient_of_variation_percent: v.coefficientOfVariationPercent,
      }));
      await batchInsert(transaction, "aws_service_volatility", {
        report_run_id: sql.Int,
        service: sql.NVarChar(255),
        mean: sql.Decimal(18, 2),
        std_dev: sql.Decimal(18, 2),
        coefficient_of_variation_percent: sql.Decimal(10, 2),
      }, rows);
    }

    // 17. Ingest Budgets Overview
    if (runData.budgets && runData.budgets.length > 0) {
      const rows = runData.budgets.map((b) => ({
        report_run_id: reportRunId,
        budget_name: b.budgetName,
        limit_amount: b.limitAmount,
        current_used: b.currentUsed,
        forecasted_spend: b.forecastedSpend,
        current_vs_budget_percent: b.currentVsBudgetPercent,
        threshold_status: b.thresholdStatus,
        health_status: b.healthStatus,
      }));
      await batchInsert(transaction, "aws_budgets_overview", {
        report_run_id: sql.Int,
        budget_name: sql.NVarChar(255),
        limit_amount: sql.Decimal(18, 2),
        current_used: sql.Decimal(18, 2),
        forecasted_spend: sql.Decimal(18, 2),
        current_vs_budget_percent: sql.Decimal(10, 2),
        threshold_status: sql.NVarChar(16),
        health_status: sql.NVarChar(16),
      }, rows);
    }

    // 18. Ingest Unbudgeted Accounts
    if (runData.unbudgetedAccounts && runData.unbudgetedAccounts.length > 0) {
      const rows = runData.unbudgetedAccounts.map((u) => ({
        report_run_id: reportRunId,
        account_name: u.accountName,
        aws_account_id: u.awsAccountId,
        status: u.status,
        current_month_spend: u.currentMonthSpend,
        previous_month_spend: u.previousMonthSpend,
        mom_change_percent: u.momChangePercent,
        top_cost_driver: u.topCostDriver ?? null,
      }));
      await batchInsert(transaction, "aws_unbudgeted_accounts", {
        report_run_id: sql.Int,
        account_name: sql.NVarChar(255),
        aws_account_id: sql.Char(12),
        status: sql.NVarChar(32),
        current_month_spend: sql.Decimal(18, 2),
        previous_month_spend: sql.Decimal(18, 2),
        mom_change_percent: sql.Decimal(10, 2),
        top_cost_driver: sql.NVarChar(255),
      }, rows);
    }

    // 19. Ingest Governance Summary
    if (runData.governanceSummary) {
      const g = runData.governanceSummary;
      const gRequest = new sql.Request(transaction);
      gRequest.input("reportRunId", sql.Int, reportRunId);
      gRequest.input("selectedMonth", sql.Char(7), g.selectedMonth || runData.currentMonth);
      gRequest.input("totalAccounts", sql.Int, g.totalAccounts || 0);
      gRequest.input("activeAccounts", sql.Int, g.activeAccounts || 0);
      gRequest.input("suspendedAccounts", sql.Int, g.suspendedAccounts || 0);
      gRequest.input("accountsWithBudget", sql.Int, g.accountsWithBudget || 0);
      gRequest.input("accountsWithNoBudget", sql.Int, g.accountsWithNoBudget || 0);
      gRequest.input("budgetCoveragePct", sql.Decimal(6, 2), g.budgetCoveragePct || 0);
      gRequest.input("activeSpendTotal", sql.Decimal(18, 2), g.activeSpendTotal || 0);
      gRequest.input("spendUnderBudget", sql.Decimal(18, 2), g.spendUnderBudget || 0);
      gRequest.input("spendWithNoBudget", sql.Decimal(18, 2), g.spendWithNoBudget || 0);
      gRequest.input("shareSpendUncoveredPct", sql.Decimal(6, 2), g.shareSpendUncoveredPct || 0);
      gRequest.input("sumBudgetLimits", sql.Decimal(18, 2), g.sumBudgetLimits || 0);
      gRequest.input("suspendedAccountsChargingCount", sql.Int, g.suspendedAccountsChargingCount || 0);
      gRequest.input("suspendedAccountsSpendTotal", sql.Decimal(18, 2), g.suspendedAccountsSpendTotal || 0);
      gRequest.input("suspendedPeriodLabel", sql.NVarChar(64), g.suspendedPeriodLabel || null);

      const gQuery = `
        INSERT INTO [aws_governance_summary] (
          report_run_id, selected_month, total_accounts, active_accounts, suspended_accounts,
          accounts_with_budget, accounts_with_no_budget, budget_coverage_pct,
          active_spend_total, spend_under_budget, spend_with_no_budget, share_spend_uncovered_pct,
          sum_budget_limits, suspended_accounts_charging_count, suspended_accounts_spend_total,
          suspended_period_label
        )
        VALUES (
          @reportRunId, @selectedMonth, @totalAccounts, @activeAccounts, @suspendedAccounts,
          @accountsWithBudget, @accountsWithNoBudget, @budgetCoveragePct,
          @activeSpendTotal, @spendUnderBudget, @spendWithNoBudget, @shareSpendUncoveredPct,
          @sumBudgetLimits, @suspendedAccountsChargingCount, @suspendedAccountsSpendTotal,
          @suspendedPeriodLabel
        );
      `;
      await gRequest.query(gQuery);
    }

    // 20. Complete Run Record
    const durationMs = Date.now() - startedAt;
    await completeReportRun(transaction, reportRunId, durationMs, runData.logText);

    await transaction.commit();
    log(`✅ Successfully saved run #${reportRunId} to SQL Server in ${durationMs}ms`);
    return { success: true, reportRunId };
  } catch (err) {
    await transaction.rollback();
    log(`❌ SQL Server Ingestion Error for ${accountConfig.name}: ${err.message}`);
    throw err;
  }
}

module.exports = {
  saveAwsReportRunToDatabase,
};
