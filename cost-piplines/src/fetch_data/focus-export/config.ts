import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import winston from 'winston';

export const AZURE_TENANT_ID = process.env.AZURE_TENANT_ID || '';
export const AZURE_CLIENT_ID = process.env.AZURE_CLIENT_ID || '';
export const AZURE_CLIENT_SECRET = process.env.AZURE_CLIENT_SECRET || '';
export const AZURE_STORAGE_ACCOUNT_NAME = process.env.AZURE_STORAGE_ACCOUNT_NAME || '';
export const AZURE_STORAGE_CONTAINER_NAME = process.env.AZURE_STORAGE_CONTAINER_NAME || '';
export const DATABASE_URL = process.env.DATABASE_URL || '';

export const exportPrefix = process.env.AZURE_EXPORT_PREFIX || 'finops_dir/CFfinopexport-focus-cost/';
export const monthsBack = Number.parseInt(process.env.MONTHS_BACK || '6', 10);
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.DB_REQUEST_TIMEOUT_MS || '60000', 10);
export const CONNECTION_TIMEOUT_MS = Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '30000', 10);

// Fields hashed to detect duplicate rows. Excludes x_SkuDetails (volatile metadata).
// All metadata fields retained to preserve parallel cluster instances
export const VOLATILE_FIELDS: string[] = [];

// Fields identifying the charge line dimensionally
export const CHARGE_KEY_FIELDS = [
    'ResourceId',
    'SkuPriceId',
    'x_SkuMeterId',
    'ChargePeriodStart',
    'ChargePeriodEnd',
    'ChargeCategory',
    'SubAccountId',
    'PricingCategory',
    'RegionId',
    'ChargeClass',
    'ChargeDescription',
];

// SQL Server & Driver limits
export const SQLSERVER_MAX_PARAMS = 2100;
export const SQLSERVER_MAX_ROWS_PER_INSERT = 1000;
export const PARAM_SAFETY_MARGIN = 100;
export const INSERT_CONCURRENCY = 6;
export const DAY_FLUSH_THRESHOLD = 5000;

// Validate environment
export function validateEnvironment(): void {
    if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !AZURE_STORAGE_ACCOUNT_NAME || !AZURE_STORAGE_CONTAINER_NAME) {
        throw new Error('Missing required Azure Storage environment variables');
    }
    if (!DATABASE_URL) {
        throw new Error('Missing required DATABASE_URL environment variable');
    }
}

// Parses "sqlserver://[user:password@]host:port;key1=value1;key2=value2;..." into driver config
export function parseSqlServerUrl(url: string) {
    const [hostPart, ...paramParts] = url.split(';');
    const match = hostPart.match(/^sqlserver:\/\/(?:([^:@]+):([^@]+)@)?([^:;]+):(\d+)$/i);
    if (!match) throw new Error(`Could not parse host/port from DATABASE_URL: ${hostPart}`);
    const [, userFromUrl, passwordFromUrl, server, port] = match;

    const params = Object.fromEntries(
        paramParts
            .filter(Boolean)
            .map((p) => {
                const idx = p.indexOf('=');
                return idx === -1 ? [p.trim().toLowerCase(), ''] : [p.slice(0, idx).trim().toLowerCase(), p.slice(idx + 1).trim()];
            })
    );

    return {
        server,
        port: Number(port),
        database: params.database,
        user: userFromUrl || params.user,
        password: passwordFromUrl || params.password,
        options: {
            encrypt: params.encrypt ? params.encrypt.toLowerCase() === 'true' : true,
            trustServerCertificate: params.trustservercertificate
                ? params.trustservercertificate.toLowerCase() === 'true'
                : false,
        },
        pool: {
            min: 2,
            max: 10,
        },
    };
}

// Logger setup
const LOG_DIR = path.resolve(process.cwd(), 'src', 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

export const logger = winston.createLogger({
    level: LOG_LEVEL,
    format: winston.format.combine(winston.format.timestamp(), winston.format.errors({ stack: true }), winston.format.json()),
    defaultMeta: { service: 'ingest-focus-export' },
    transports: [
        new winston.transports.File({ filename: path.join(LOG_DIR, 'ingest-focus-export.log'), maxsize: 5 * 1024 * 1024, maxFiles: 5 }),
        new winston.transports.Console({
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.timestamp({ format: 'HH:mm:ss' }),
                winston.format.printf(({ timestamp, level, message, ...meta }) => {
                    const extra = Object.keys(meta).filter((k) => k !== 'service').length
                        ? ' ' + JSON.stringify(Object.fromEntries(Object.entries(meta).filter(([k]) => k !== 'service')))
                        : '';
                    return `${timestamp} [${level}] ${message}${extra}`;
                })
            ),
        }),
    ],
});
