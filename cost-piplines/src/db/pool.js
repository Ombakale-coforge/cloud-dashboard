/**
 * src/db/pool.js
 * 
 * Microsoft SQL Server connection pool and database utility for the FinOps platform.
 * Supports DATABASE_URL connection strings and discrete DB_* environment variables.
 */

require("dotenv").config();
const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config({ path: path.resolve(__dirname, "../../../.env") });

const sql = require("mssql");

let poolPromise = null;

/**
 * Parses a sqlserver:// connection string into an mssql config object.
 */
function parseConnectionString(connStr) {
  if (!connStr) return null;

  try {
    // If it's a URL like sqlserver://server:1433;database=...;user=...;password=...
    if (connStr.startsWith("sqlserver://") || connStr.startsWith("mssql://")) {
      const cleaned = connStr.replace(/^(sqlserver|mssql):\/\//, "");
      const [hostPart, ...paramParts] = cleaned.split(";");
      const [server, portStr] = hostPart.split(":");

      const config = {
        server: server || "localhost",
        port: portStr ? parseInt(portStr, 10) : 1433,
        options: {
          encrypt: true,
          trustServerCertificate: true,
        },
      };

      for (const param of paramParts) {
        const [k, v] = param.split("=");
        if (!k || v === undefined) continue;
        const key = k.trim().toLowerCase();
        const val = decodeURIComponent(v.trim());

        if (key === "database" || key === "initial catalog") config.database = val;
        else if (key === "user" || key === "uid" || key === "username") config.user = val;
        else if (key === "password" || key === "pwd") config.password = val;
        else if (key === "encrypt") config.options.encrypt = val.toLowerCase() !== "false";
        else if (key === "trustservercertificate") config.options.trustServerCertificate = val.toLowerCase() !== "false";
        else if (key === "connectiontimeout") config.connectionTimeout = parseInt(val, 10);
        else if (key === "requesttimeout") config.requestTimeout = parseInt(val, 10);
      }

      return config;
    }
  } catch (err) {
    console.warn("Could not parse connection string, falling back to direct config:", err.message);
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
    server: process.env.DB_SERVER || "localhost",
    port: parseInt(process.env.DB_PORT || "1433", 10),
    user: process.env.DB_USER || "sa",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "CostAnalyticsDB",
    options: {
      encrypt: process.env.DB_ENCRYPT !== "false",
      trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE !== "false",
    },
    pool: {
      max: 20,
      min: 2,
      idleTimeoutMillis: 30000,
    },
  };
}

async function getPool() {
  if (!poolPromise) {
    const config = getDbConfig();
    poolPromise = new sql.ConnectionPool(config)
      .connect()
      .then((pool) => {
        console.log(`✅ [SQL Server] Connected to database "${config.database}" on "${config.server}"`);
        pool.on("error", (err) => {
          console.error("❌ [SQL Server Pool Error]:", err);
          poolPromise = null;
        });
        return pool;
      })
      .catch((err) => {
        poolPromise = null;
        console.error("❌ [SQL Server Connection Error]:", err.message);
        throw err;
      });
  }
  return poolPromise;
}

/**
 * Execute a query with parameters against SQL Server.
 */
async function query(queryText, params = {}) {
  const pool = await getPool();
  const request = pool.request();

  for (const [key, val] of Object.entries(params)) {
    if (val === null || val === undefined) {
      request.input(key, sql.NVarChar, null);
    } else if (typeof val === "number") {
      if (Number.isInteger(val)) request.input(key, sql.Int, val);
      else request.input(key, sql.Decimal(18, 4), val);
    } else if (typeof val === "boolean") {
      request.input(key, sql.Bit, val ? 1 : 0);
    } else if (val instanceof Date) {
      request.input(key, sql.DateTime2, val);
    } else {
      request.input(key, sql.NVarChar, String(val));
    }
  }

  const result = await request.query(queryText);
  return result;
}

/**
 * Execute work inside an atomic database transaction.
 */
async function executeTransaction(callback) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin();

  try {
    const result = await callback(transaction);
    await transaction.commit();
    return result;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
}

/**
 * Close database pool on process exit.
 */
async function closePool() {
  if (poolPromise) {
    const pool = await poolPromise;
    await pool.close();
    poolPromise = null;
  }
}

module.exports = {
  sql,
  getPool,
  query,
  executeTransaction,
  closePool,
};
