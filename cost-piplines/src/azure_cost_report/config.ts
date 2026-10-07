import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import winston from 'winston';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const DATABASE_URL = process.env.DATABASE_URL || '';

export const ANOMALY_THRESHOLD_PERCENT = Number.parseFloat(process.env.ANOMALY_THRESHOLD_PERCENT || '15');
export const ANOMALY_ROLLING_MONTHS = Number.parseInt(process.env.ANOMALY_ROLLING_MONTHS || '3', 10);
export const LOG_LEVEL = process.env.LOG_LEVEL || 'info';

export const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.DB_REQUEST_TIMEOUT_MS || '60000', 10);
export const CONNECTION_TIMEOUT_MS = Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '30000', 10);

// SQL Server limits
export const SQLSERVER_MAX_PARAMS = 2100;
export const SQLSERVER_MAX_ROWS_PER_INSERT = 1000;
export const PARAM_SAFETY_MARGIN = 100;

export function validateEnvironment(): void {
    if (!DATABASE_URL) {
        throw new Error('Missing required DATABASE_URL environment variable');
    }
    if (!Number.isFinite(ANOMALY_THRESHOLD_PERCENT) || ANOMALY_THRESHOLD_PERCENT < 0) {
        throw new Error('ANOMALY_THRESHOLD_PERCENT must be a non-negative number');
    }
    if (!Number.isInteger(ANOMALY_ROLLING_MONTHS) || ANOMALY_ROLLING_MONTHS < 1) {
        throw new Error('ANOMALY_ROLLING_MONTHS must be a positive integer');
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
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

export const logger = winston.createLogger({
    level: LOG_LEVEL,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'azure-cost-report' },
    transports: [
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'azure-cost-report.log'),
            maxsize: 5 * 1024 * 1024,
            maxFiles: 5,
        }),
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
