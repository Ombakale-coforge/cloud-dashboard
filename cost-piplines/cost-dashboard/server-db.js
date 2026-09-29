/**
 * server-db.js
 * 
 * Microsoft SQL Server Data Access Layer for the Cost Intelligence Dashboard.
 * Serves Auth, Requests, and AWS Analytics directly from database tables.
 */

import sql from 'mssql';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '.env') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

let poolPromise = null;

function parseConnectionString(connStr) {
  if (!connStr) return null;

  try {
    if (connStr.startsWith('sqlserver://') || connStr.startsWith('mssql://')) {
      const cleaned = connStr.replace(/^(sqlserver|mssql):\/\//, '');
      const [hostPart, ...paramParts] = cleaned.split(';');
      const [server, portStr] = hostPart.split(':');

      const config = {
        server: server || 'localhost',
        port: portStr ? parseInt(portStr, 10) : 1433,
        options: {
          encrypt: true,
          trustServerCertificate: true,
        },
      };

      for (const param of paramParts) {
        const [k, v] = param.split('=');
        if (!k || v === undefined) continue;
        const key = k.trim().toLowerCase();
        const val = decodeURIComponent(v.trim());

        if (key === 'database' || key === 'initial catalog') config.database = val;
        else if (key === 'user' || key === 'uid' || key === 'username') config.user = val;
        else if (key === 'password' || key === 'pwd') config.password = val;
        else if (key === 'encrypt') config.options.encrypt = val.toLowerCase() !== 'false';
        else if (key === 'trustservercertificate') config.options.trustServerCertificate = val.toLowerCase() !== 'false';
        else if (key === 'connectiontimeout') config.connectionTimeout = parseInt(val, 10);
        else if (key === 'requesttimeout') config.requestTimeout = parseInt(val, 10);
      }

      return config;
    }
  } catch (err) {
    console.warn('[DB] Could not parse connection string:', err.message);
  }

  return null;
}

function getDbConfig() {
  const connStr = process.env.DATABASE_URL || process.env.SQL_DATABASE_URL || process.env.AZURE_SQL_CONNECTION_STRING;
  const parsed = parseConnectionString(connStr);

  if (parsed && parsed.server && (parsed.user || process.env.DB_USER)) {
    return {
      ...parsed,
      user: parsed.user || process.env.DB_USER,
      password: parsed.password || process.env.DB_PASSWORD,
      database: parsed.database || process.env.DB_NAME,
      pool: {
        max: 20,
        min: 2,
        idleTimeoutMillis: 30000,
      },
    };
  }

  return {
    server: process.env.DB_SERVER || 'localhost',
    port: parseInt(process.env.DB_PORT || '1433', 10),
    user: process.env.DB_USER || 'sa',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'CostAnalyticsDB',
    options: {
      encrypt: process.env.DB_ENCRYPT !== 'false',
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== 'false',
    },
    pool: {
      max: 20,
      min: 2,
      idleTimeoutMillis: 30000,
    },
  };
}

export async function getDbPool() {
  if (!poolPromise) {
    const config = getDbConfig();
    console.log(`🔌 [SQL Server] Connecting to ${config.server}:${config.port || 1433}/${config.database} as ${config.user}`);
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log(`✅ [SQL Server] Connected successfully to ${config.database}`);
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        console.error(`❌ [SQL Server] Connection failed:`, err.message);
        throw err;
      });
  }
  return poolPromise;
}

// ─────────────────────────────────────────────────────────────
// Auth Helpers (users & user_login_events)
// ─────────────────────────────────────────────────────────────

export async function getUserByEmail(email) {
  const pool = await getDbPool();
  const request = pool.request();
  request.input('email', sql.NVarChar(255), email.trim().toLowerCase());
  const result = await request.query(`
    SELECT TOP 1 id, name, email, password_hash, department, role, is_active, created_at
    FROM [users]
    WHERE LOWER(email) = @email
  `);
  return result.recordset[0] || null;
}

export async function createUser({ name, email, password, department, role = 'basic' }) {
  const pool = await getDbPool();
  const hashedPassword = bcrypt.hashSync(password, 10);
  const normalizedEmail = email.trim().toLowerCase();
  const displayName = name?.trim() || normalizedEmail.split('@')[0].replace(/[._-]/g, ' ');
  const dept = department?.trim() || 'Digital Engineering';

  const request = pool.request();
  request.input('email', sql.NVarChar(255), normalizedEmail);
  request.input('name', sql.NVarChar(255), displayName);
  request.input('passwordHash', sql.NVarChar(255), hashedPassword);
  request.input('department', sql.NVarChar(128), dept);
  request.input('role', sql.NVarChar(32), role);

  const query = `
    INSERT INTO [users] (email, name, password_hash, department, role, is_active, created_at, updated_at)
    OUTPUT inserted.id, inserted.name, inserted.email, inserted.department, inserted.role, inserted.created_at
    VALUES (@email, @name, @passwordHash, @department, @role, 1, SYSDATETIME(), SYSDATETIME());
  `;

  const result = await request.query(query);
  return result.recordset[0];
}

export async function recordLoginEvent({ userId, ipAddress, userAgent, eventType = 'login', success = true, failureReason = null }) {
  try {
    const pool = await getDbPool();
    const request = pool.request();
    request.input('userId', sql.Int, userId || null);
    request.input('eventType', sql.NVarChar(32), eventType);
    request.input('ipAddress', sql.NVarChar(45), ipAddress || null);
    request.input('userAgent', sql.NVarChar(512), userAgent || null);
    request.input('success', sql.Bit, success ? 1 : 0);
    request.input('failureReason', sql.NVarChar(255), failureReason);

    await request.query(`
      INSERT INTO [user_login_events] (user_id, event_type, ip_address, user_agent, success, failure_reason, created_at)
      VALUES (@userId, @eventType, @ipAddress, @userAgent, @success, @failureReason, SYSDATETIME());
    `);
  } catch (err) {
    console.warn(`[Login Event Log Warning]: ${err.message}`);
  }
}

export function verifyPassword(inputPassword, storedHash) {
  if (!storedHash) return false;
  if (storedHash === inputPassword) return true; // Plaintext fallback for legacy
  try {
    return bcrypt.compareSync(inputPassword, storedHash);
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────────────────────
// Account Requests Helpers (account_requests & children)
// ─────────────────────────────────────────────────────────────

export async function getAccountRequests() {
  const pool = await getDbPool();
  const reqRes = await pool.request().query(`
    SELECT 
      id, request_number, project_name, requester_name, requester_email, department,
      environment, cloud_provider, estimated_monthly_spend, business_justification,
      required_by_date, compliance_framework, technical_contact_email,
      primary_region, secondary_region, preferred_aws_account_id, azure_subscription_id,
      status, admin_notes, reviewed_by, reviewed_at, created_at, updated_at
    FROM [account_requests]
    ORDER BY created_at DESC
  `);

  const requests = reqRes.recordset;
  if (requests.length === 0) return [];

  const reqIds = requests.map((r) => r.id);
  const idList = reqIds.join(',');

  const [usersRes, splitsRes, ccRes, tagsRes] = await Promise.all([
    pool.request().query(`SELECT * FROM [account_request_users] WHERE request_id IN (${idList})`),
    pool.request().query(`SELECT * FROM [account_request_budget_splits] WHERE request_id IN (${idList})`),
    pool.request().query(`SELECT * FROM [account_request_cost_centers] WHERE request_id IN (${idList})`),
    pool.request().query(`SELECT * FROM [account_request_tags] WHERE request_id IN (${idList})`),
  ]);

  const usersMap = {};
  usersRes.recordset.forEach((u) => {
    if (!usersMap[u.request_id]) usersMap[u.request_id] = [];
    usersMap[u.request_id].push({ name: u.name, email: u.email, role: u.role, accessLevel: u.access_level });
  });

  const splitsMap = {};
  splitsRes.recordset.forEach((s) => {
    if (!splitsMap[s.request_id]) splitsMap[s.request_id] = [];
    splitsMap[s.request_id].push({ category: s.category, percentage: s.percentage, amount: s.amount });
  });

  const ccMap = {};
  ccRes.recordset.forEach((c) => {
    if (!ccMap[c.request_id]) ccMap[c.request_id] = [];
    ccMap[c.request_id].push({ code: c.cost_center_code, percentage: c.percentage });
  });

  const tagsMap = {};
  tagsRes.recordset.forEach((t) => {
    if (!tagsMap[t.request_id]) tagsMap[t.request_id] = {};
    tagsMap[t.request_id][t.tag_key] = t.tag_value;
  });

  return requests.map((r) => ({
    id: `req-${r.id}`,
    requestId: r.id,
    requestNumber: r.request_number,
    projectName: r.project_name,
    requesterName: r.requester_name,
    requesterEmail: r.requester_email,
    department: r.department,
    environment: r.environment,
    cloudProvider: r.cloud_provider,
    estimatedMonthlySpend: Number(r.estimated_monthly_spend) || 0,
    businessJustification: r.business_justification,
    requiredByDate: r.required_by_date ? r.required_by_date.toISOString().split('T')[0] : null,
    complianceFramework: r.compliance_framework,
    technicalContactEmail: r.technical_contact_email,
    primaryRegion: r.primary_region,
    secondaryRegion: r.secondary_region,
    preferredAwsAccountId: r.preferred_aws_account_id,
    azureSubscriptionId: r.azure_subscription_id,
    status: r.status,
    adminNotes: r.admin_notes,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
    submittedAt: r.created_at,
    createdAt: r.created_at,
    users: usersMap[r.id] || [],
    budgetSplits: splitsMap[r.id] || [],
    costCenters: ccMap[r.id] || [],
    tags: tagsMap[r.id] || {},
  }));
}

export async function createAccountRequest(data) {
  const pool = await getDbPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const reqNum = `REQ-${Date.now().toString().slice(-6)}`;
    const request = new sql.Request(transaction);

    request.input('requestNumber', sql.NVarChar(64), reqNum);
    request.input('projectName', sql.NVarChar(255), data.projectName);
    request.input('requesterName', sql.NVarChar(255), data.requesterName || data.projectName);
    request.input('requesterEmail', sql.NVarChar(255), data.requesterEmail || 'requester@coforge.com');
    request.input('department', sql.NVarChar(128), data.department || 'Engineering');
    request.input('environment', sql.NVarChar(32), data.environment || 'Development');
    request.input('cloudProvider', sql.NVarChar(32), data.cloudProvider || 'AWS');
    request.input('estimatedMonthlySpend', sql.Decimal(18, 2), Number(data.estimatedMonthlySpend) || 0);
    request.input('businessJustification', sql.NVarChar(sql.MAX), data.businessJustification || null);
    request.input('requiredByDate', sql.Date, data.requiredByDate ? new Date(data.requiredByDate) : null);
    request.input('complianceFramework', sql.NVarChar(64), data.complianceFramework || null);
    request.input('technicalContactEmail', sql.NVarChar(255), data.technicalContactEmail || null);
    request.input('primaryRegion', sql.NVarChar(64), data.primaryRegion || 'us-east-1');
    request.input('secondaryRegion', sql.NVarChar(64), data.secondaryRegion || null);
    request.input('preferredAwsAccountId', sql.NVarChar(32), data.preferredAwsAccountId || null);
    request.input('azureSubscriptionId', sql.NVarChar(64), data.azureSubscriptionId || null);
    request.input('status', sql.NVarChar(32), data.status || 'pending');

    const insertQuery = `
      INSERT INTO [account_requests] (
        request_number, project_name, requester_name, requester_email, department,
        environment, cloud_provider, estimated_monthly_spend, business_justification,
        required_by_date, compliance_framework, technical_contact_email,
        primary_region, secondary_region, preferred_aws_account_id, azure_subscription_id,
        status, created_at, updated_at
      )
      OUTPUT inserted.id
      VALUES (
        @requestNumber, @projectName, @requesterName, @requesterEmail, @department,
        @environment, @cloudProvider, @estimatedMonthlySpend, @businessJustification,
        @requiredByDate, @complianceFramework, @technicalContactEmail,
        @primaryRegion, @secondaryRegion, @preferredAwsAccountId, @azureSubscriptionId,
        @status, SYSDATETIME(), SYSDATETIME()
      );
    `;

    const res = await request.query(insertQuery);
    const newId = res.recordset[0].id;

    // Users
    if (Array.isArray(data.users) && data.users.length > 0) {
      for (const u of data.users) {
        const uReq = new sql.Request(transaction);
        uReq.input('requestId', sql.Int, newId);
        uReq.input('name', sql.NVarChar(255), u.name || '');
        uReq.input('email', sql.NVarChar(255), u.email || '');
        uReq.input('role', sql.NVarChar(64), u.role || 'Contributor');
        uReq.input('accessLevel', sql.NVarChar(64), u.accessLevel || 'Read');
        await uReq.query(`
          INSERT INTO [account_request_users] (request_id, name, email, role, access_level)
          VALUES (@requestId, @name, @email, @role, @accessLevel);
        `);
      }
    }

    // Budget splits
    if (Array.isArray(data.budgetSplits) && data.budgetSplits.length > 0) {
      for (const s of data.budgetSplits) {
        const sReq = new sql.Request(transaction);
        sReq.input('requestId', sql.Int, newId);
        sReq.input('category', sql.NVarChar(64), s.category);
        sReq.input('percentage', sql.Decimal(6, 2), s.percentage || 0);
        sReq.input('amount', sql.Decimal(18, 2), s.amount || 0);
        await sReq.query(`
          INSERT INTO [account_request_budget_splits] (request_id, category, percentage, amount)
          VALUES (@requestId, @category, @percentage, @amount);
        `);
      }
    }

    // Tags
    if (data.tags && typeof data.tags === 'object') {
      for (const [k, v] of Object.entries(data.tags)) {
        const tReq = new sql.Request(transaction);
        tReq.input('requestId', sql.Int, newId);
        tReq.input('tagKey', sql.NVarChar(128), k);
        tReq.input('tagValue', sql.NVarChar(255), String(v));
        await tReq.query(`
          INSERT INTO [account_request_tags] (request_id, tag_key, tag_value)
          VALUES (@requestId, @tagKey, @tagValue);
        `);
      }
    }

    await transaction.commit();
    return { ...data, id: `req-${newId}`, requestId: newId, requestNumber: reqNum, status: data.status || 'pending' };
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

export async function updateAccountRequestStatus(id, { status, adminNotes, reviewedBy }) {
  const pool = await getDbPool();
  const numericId = parseInt(String(id).replace(/[^0-9]/g, ''), 10);
  if (!numericId) throw new Error('Invalid request ID');

  const request = pool.request();
  request.input('id', sql.Int, numericId);
  request.input('status', sql.NVarChar(32), status || 'pending');
  request.input('adminNotes', sql.NVarChar(sql.MAX), adminNotes || null);
  request.input('reviewedBy', sql.NVarChar(255), reviewedBy || 'Admin');

  const query = `
    UPDATE [account_requests]
    SET 
      status = @status,
      admin_notes = COALESCE(@adminNotes, admin_notes),
      reviewed_by = @reviewedBy,
      reviewed_at = SYSDATETIME(),
      updated_at = SYSDATETIME()
    OUTPUT inserted.*
    WHERE id = @id;
  `;

  const result = await request.query(query);
  if (result.recordset.length === 0) throw new Error('Request not found');
  const r = result.recordset[0];
  return {
    id: `req-${r.id}`,
    requestId: r.id,
    requestNumber: r.request_number,
    projectName: r.project_name,
    status: r.status,
    adminNotes: r.admin_notes,
    reviewedBy: r.reviewed_by,
    reviewedAt: r.reviewed_at,
  };
}

// ─────────────────────────────────────────────────────────────
// AWS Cost Analytics Query Helpers
// ─────────────────────────────────────────────────────────────

export async function getAwsAccountsMetadata() {
  const pool = await getDbPool();
  const res = await pool.request().query(`
    SELECT config_id AS id, name, region, is_primary
    FROM [aws_accounts]
    WHERE is_active = 1
    ORDER BY is_primary DESC, name ASC
  `);

  return res.recordset.map((a) => ({
    id: a.id,
    name: a.name,
    path: a.is_primary ? '/data' : `/data/accounts/${a.id}`,
    isPrimary: a.is_primary,
    region: a.region,
  }));
}

export async function getLatestSuccessfulRunId(accountConfigId) {
  const pool = await getDbPool();
  const request = pool.request();
  request.input('configId', sql.NVarChar(32), accountConfigId || 'account-1');

  const query = `
    SELECT TOP 1 r.id, r.current_month, r.window_start, r.window_end
    FROM [aws_report_runs] r
    INNER JOIN [aws_accounts] a ON r.account_id = a.id
    WHERE a.config_id = @configId AND r.status = 'success'
    ORDER BY r.id DESC;
  `;

  const result = await request.query(query);
  return result.recordset[0] || null;
}

export async function queryAwsTableData(accountConfigId, filename) {
  const run = await getLatestSuccessfulRunId(accountConfigId);
  if (!run) return null;

  const reportRunId = run.id;
  const pool = await getDbPool();
  const request = pool.request();
  request.input('reportRunId', sql.Int, reportRunId);

  const cleanName = filename.toLowerCase().replace('.csv', '').replace('.json', '');

  switch (cleanName) {
    case 'current_month_total': {
      const res = await request.query(`
        SELECT total_cost AS [Total Cost]
        FROM [aws_monthly_totals]
        WHERE report_run_id = @reportRunId AND is_current_month = 1
      `);
      return res.recordset.map((r) => ({ 'Total Cost': Number(r['Total Cost']) }));
    }

    case 'monthly_totals_last_6_months': {
      const res = await request.query(`
        SELECT month AS [Month], total_cost AS [Total Cost]
        FROM [aws_monthly_totals]
        WHERE report_run_id = @reportRunId
        ORDER BY month ASC
      `);
      return res.recordset.map((r) => ({ Month: r.Month, 'Total Cost': Number(r['Total Cost']) }));
    }

    case 'latest_month_services': {
      const res = await request.query(`
        SELECT service AS [Service], cost AS [Cost]
        FROM [aws_cost_by_service]
        WHERE report_run_id = @reportRunId AND month = '${run.current_month}'
        ORDER BY cost DESC
      `);
      return res.recordset.map((r) => ({ Service: r.Service, Cost: Number(r.Cost) }));
    }

    case 'top_10_services': {
      const res = await request.query(`
        SELECT service AS [Service], cost AS [Cost]
        FROM [aws_top_services]
        WHERE report_run_id = @reportRunId
        ORDER BY rank ASC
      `);
      return res.recordset.map((r) => ({ Service: r.Service, Cost: Number(r.Cost) }));
    }

    case 'mom_change': {
      const res = await request.query(`
        SELECT 
          month AS [Month],
          total_cost AS [Total Cost],
          previous_month_cost AS [Previous Month Cost],
          difference AS [Difference],
          mom_percent_change AS [MoM % Change]
        FROM [aws_mom_change]
        WHERE report_run_id = @reportRunId
        ORDER BY month ASC
      `);
      return res.recordset.map((r) => ({
        Month: r.Month,
        'Total Cost': Number(r['Total Cost']),
        'Previous Month Cost': r['Previous Month Cost'] !== null ? Number(r['Previous Month Cost']) : '',
        Difference: r['Difference'] !== null ? Number(r['Difference']) : '',
        'MoM % Change': r['MoM % Change'] !== null ? Number(r['MoM % Change']) : '',
      }));
    }

    case 'pareto_analysis': {
      const res = await request.query(`
        SELECT 
          service AS [Service],
          cost AS [Cost],
          cumulative_cost AS [Cumulative Cost],
          cumulative_percent AS [Cumulative %],
          pareto_class AS [Pareto Class]
        FROM [aws_pareto_analysis]
        WHERE report_run_id = @reportRunId
        ORDER BY rank ASC
      `);
      return res.recordset.map((r) => ({
        Service: r.Service,
        Cost: Number(r.Cost),
        'Cumulative Cost': Number(r['Cumulative Cost']),
        'Cumulative %': Number(r['Cumulative %']),
        'Pareto Class': r['Pareto Class'],
      }));
    }

    case 'anomaly_flags': {
      const res = await request.query(`
        SELECT 
          month AS [Month],
          total_cost AS [Total Cost],
          rolling_avg AS [Rolling Avg (3M)],
          rolling_std AS [Rolling Std (3M)],
          anomaly_flag AS [Anomaly Flag]
        FROM [aws_anomaly_flags]
        WHERE report_run_id = @reportRunId
        ORDER BY month ASC
      `);
      return res.recordset.map((r) => ({
        Month: r.Month,
        'Total Cost': Number(r['Total Cost']),
        'Rolling Avg (3M)': r['Rolling Avg (3M)'] !== null ? Number(r['Rolling Avg (3M)']) : '',
        'Rolling Std (3M)': r['Rolling Std (3M)'] !== null ? Number(r['Rolling Std (3M)']) : '',
        'Anomaly Flag': r['Anomaly Flag'],
      }));
    }

    case 'recurring_vs_onetime': {
      const res = await request.query(`
        SELECT 
          service AS [Service],
          active_months AS [Active Months],
          total_months_in_run AS [Total Months in Run],
          active_percent AS [Active %],
          total_cost_over_period AS [Total Cost Over Period],
          classification AS [Classification]
        FROM [aws_recurring_vs_onetime]
        WHERE report_run_id = @reportRunId
        ORDER BY total_cost_over_period DESC
      `);
      return res.recordset.map((r) => ({
        Service: r.Service,
        'Active Months': r['Active Months'],
        'Total Months in Run': r['Total Months in Run'],
        'Active %': Number(r['Active %']),
        'Total Cost Over Period': Number(r['Total Cost Over Period']),
        Classification: r.Classification,
      }));
    }

    case 'new_services_flag': {
      const res = await request.query(`
        SELECT 
          service AS [Service],
          cost_in_latest_month AS [Cost in Latest Month],
          first_seen_month AS [First Seen Month],
          note AS [Note]
        FROM [aws_new_services_flag]
        WHERE report_run_id = @reportRunId
        ORDER BY cost_in_latest_month DESC
      `);
      return res.recordset.map((r) => ({
        Service: r.Service,
        'Cost in Latest Month': Number(r['Cost in Latest Month']),
        'First Seen Month': r['First Seen Month'],
        Note: r.Note || '',
      }));
    }

    case 'category_monthly_costs': {
      const res = await request.query(`
        SELECT 
          month AS [Month],
          category AS [Category],
          cost AS [Cost],
          share_percent AS [Share %]
        FROM [aws_category_monthly_costs]
        WHERE report_run_id = @reportRunId
        ORDER BY month ASC, cost DESC
      `);
      return res.recordset.map((r) => ({
        Month: r.Month,
        Category: r.Category,
        Cost: Number(r.Cost),
        'Share %': Number(r['Share %']),
      }));
    }

    case 'forecast_simple': {
      const res = await request.query(`
        SELECT 
          forecast_month AS [Forecast Month],
          projected_cost AS [Projected Cost],
          method AS [Method]
        FROM [aws_forecast]
        WHERE report_run_id = @reportRunId
        ORDER BY forecast_month ASC
      `);
      return res.recordset.map((r) => ({
        'Forecast Month': r['Forecast Month'],
        'Projected Cost': Number(r['Projected Cost']),
        Method: r.Method,
      }));
    }

    case 'service_volatility': {
      const res = await request.query(`
        SELECT 
          service AS [Service],
          mean AS [Mean],
          std_dev AS [Std Dev],
          coefficient_of_variation_percent AS [Coefficient of Variation %]
        FROM [aws_service_volatility]
        WHERE report_run_id = @reportRunId
        ORDER BY std_dev DESC
      `);
      return res.recordset.map((r) => ({
        Service: r.Service,
        Mean: Number(r.Mean),
        'Std Dev': Number(r['Std Dev']),
        'Coefficient of Variation %': Number(r['Coefficient of Variation %']),
      }));
    }

    case 'cost_by_service_wide': {
      const res = await request.query(`
        SELECT month, service, cost
        FROM [aws_cost_by_service]
        WHERE report_run_id = @reportRunId
        ORDER BY month ASC
      `);
      const rows = res.recordset;
      const months = [...new Set(rows.map((r) => r.month))].sort();
      const wideRows = [];

      for (const m of months) {
        const monthItems = rows.filter((r) => r.month === m);
        const row = { Month: m };
        let total = 0;
        for (const item of monthItems) {
          const costVal = Number(item.cost);
          row[item.service] = costVal;
          total += costVal;
        }
        row['Total Cost'] = Math.round(total * 100) / 100;
        wideRows.push(row);
      }
      return wideRows;
    }

    case 'cost_by_linked_account': {
      const res = await request.query(`
        SELECT linked_account AS [Linked Account], cost AS [Cost]
        FROM [aws_cost_by_linked_account]
        WHERE report_run_id = @reportRunId AND month = '${run.current_month}'
        ORDER BY cost DESC
      `);
      return res.recordset.map((r) => ({ 'Linked Account': r['Linked Account'], Cost: Number(r.Cost) }));
    }

    case 'cost_by_linked_account_wide': {
      const res = await request.query(`
        SELECT linked_account, month, cost
        FROM [aws_cost_by_linked_account]
        WHERE report_run_id = @reportRunId
      `);
      const rows = res.recordset;
      const accounts = [...new Set(rows.map((r) => r.linked_account))];
      const wideRows = [];

      for (const acc of accounts) {
        const accItems = rows.filter((r) => r.linked_account === acc);
        const row = { 'Linked Account': acc };
        for (const item of accItems) {
          row[item.month] = Number(item.cost);
        }
        wideRows.push(row);
      }
      return wideRows;
    }

    case 'account_cost_variance': {
      const res = await request.query(`
        SELECT 
          linked_account AS [Linked Account],
          prev_month_cost AS [Prev Month Cost],
          curr_month_cost AS [Curr Month Cost],
          difference AS [Difference],
          percentage_change AS [Percentage Change]
        FROM [aws_account_cost_variance]
        WHERE report_run_id = @reportRunId
        ORDER BY curr_month_cost DESC
      `);
      return res.recordset.map((r) => ({
        'Linked Account': r['Linked Account'],
        'Prev Month Cost': Number(r['Prev Month Cost']),
        'Curr Month Cost': Number(r['Curr Month Cost']),
        Difference: Number(r.Difference),
        'Percentage Change': Number(r['Percentage Change']),
      }));
    }

    case 'governance_summary': {
      const res = await request.query(`
        SELECT TOP 1 *
        FROM [aws_governance_summary]
        WHERE report_run_id = @reportRunId
      `);
      if (res.recordset.length === 0) return null;
      const g = res.recordset[0];
      return {
        totalAccounts: g.total_accounts,
        activeAccounts: g.active_accounts,
        suspendedAccounts: g.suspended_accounts,
        accountsWithBudget: g.accounts_with_budget,
        accountsWithNoBudget: g.accounts_with_no_budget,
        budgetCoveragePct: Number(g.budget_coverage_pct),
        selectedMonth: g.selected_month,
        activeSpendTotal: Number(g.active_spend_total),
        spendUnderBudget: Number(g.spend_under_budget),
        spendWithNoBudget: Number(g.spend_with_no_budget),
        shareSpendUncoveredPct: Number(g.share_spend_uncovered_pct),
        sumBudgetLimits: Number(g.sum_budget_limits),
        suspendedAccountsChargingCount: g.suspended_accounts_charging_count,
        suspendedAccountsSpendTotal: Number(g.suspended_accounts_spend_total),
        suspendedPeriodLabel: g.suspended_period_label,
      };
    }

    case 'budgets_overview': {
      const res = await request.query(`
        SELECT 
          budget_name AS [Budget Name],
          budget_type AS [Budget Type],
          budget_limit AS [Budget Limit ($)],
          actual_spend AS [Actual Spend ($)],
          forecasted_spend AS [Forecasted Spend ($)],
          spend_vs_limit_pct AS [Spend vs Limit (%)],
          unit AS [Unit],
          time_unit AS [Time Unit],
          status AS [Status]
        FROM [aws_budgets_overview]
        WHERE report_run_id = @reportRunId
        ORDER BY budget_limit DESC
      `);
      return res.recordset.map((r) => ({
        'Budget Name': r['Budget Name'],
        'Budget Type': r['Budget Type'],
        'Budget Limit ($)': Number(r['Budget Limit ($)']),
        'Actual Spend ($)': Number(r['Actual Spend ($)']),
        'Forecasted Spend ($)': r['Forecasted Spend ($)'] !== null ? Number(r['Forecasted Spend ($)']) : null,
        'Spend vs Limit (%)': Number(r['Spend vs Limit (%)']),
        Unit: r.Unit,
        'Time Unit': r['Time Unit'],
        Status: r.Status,
      }));
    }

    case 'unbudgeted_accounts': {
      const res = await request.query(`
        SELECT 
          account_id AS [Account ID],
          account_name AS [Account Name],
          status AS [Status],
          email AS [Email],
          joined_date AS [Joined Date],
          latest_month_cost AS [Latest Month Cost ($)]
        FROM [aws_unbudgeted_accounts]
        WHERE report_run_id = @reportRunId
        ORDER BY latest_month_cost DESC
      `);
      return res.recordset.map((r) => ({
        'Account ID': r['Account ID'],
        'Account Name': r['Account Name'],
        Status: r.Status,
        Email: r.Email || '',
        'Joined Date': r['Joined Date'] || '',
        'Latest Month Cost ($)': Number(r['Latest Month Cost ($)']),
      }));
    }

    default:
      return null;
  }
}
