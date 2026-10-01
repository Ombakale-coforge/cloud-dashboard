import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import winston from 'winston';
import type { AlertConfiguration } from './types';

// ── Database ────────────────────────────────────────────────────────
export const DATABASE_URL = process.env.DATABASE_URL || '';
export const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.DB_REQUEST_TIMEOUT_MS || '60000', 10);
export const CONNECTION_TIMEOUT_MS = Number.parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '30000', 10);

// ── Email ───────────────────────────────────────────────────────────
export const EMAIL_MODE = (process.env.EMAIL_MODE || 'preview').toLowerCase() as 'preview' | 'send';

// ── Alert thresholds ────────────────────────────────────────────────
export const ALERT_CONFIG: AlertConfiguration = {
    baselineDays: 7,
    dataLagDays: 1,

    subscription: {
        minimumPercentIncrease: 25,
        minimumAbsoluteIncrease: 1000,
        minimumBaselineDaysWithData: 5,
    },
    service: {
        minimumPercentIncrease: 30,
        minimumAbsoluteIncrease: 500,
        minimumBaselineDaysWithData: 4,
    },
    resource: {
        minimumPercentIncrease: 40,
        minimumAbsoluteIncrease: 300,
        minimumBaselineDaysWithData: 3,
    },
    quantity: {
        minimumPercentIncrease: 30,
        minimumAbsoluteIncrease: 1,
        minimumBaselineQuantity: 5,
        minimumBaselineDaysWithData: 4,
        minimumAssociatedCost: Number(process.env.ALERT_QUANTITY_MIN_COST || '50'),
    },
    newResource: {
        minimumDailyCost: 1000,
        lookbackDays: 30,
    },
    correlation: {
        driverCoverageThreshold: 0.7,
    },
};

// ── Resource alert exclusion terms ──────────────────────────────────
export const RESOURCE_ALERT_EXCLUSIONS = ['credit', 'exemption', 'adjustment', 'refund'];

// ── Environment validation ──────────────────────────────────────────
export function validateEnvironment(requireDb = true): void {
    if (requireDb && !DATABASE_URL) {
        throw new Error('Missing required DATABASE_URL environment variable');
    }
}

export function validateEmailEnvironment(): void {
    const required = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'ALERT_EMAIL_FROM', 'ALERT_EMAIL_TO'];
    const missing = required.filter((k) => !process.env[k]);
    if (missing.length > 0) {
        throw new Error(`Missing email environment variables: ${missing.join(', ')}`);
    }
}

// ── SQL Server URL parser (matches azure_cost_report/config.ts) ─────
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
                return idx === -1
                    ? [p.trim().toLowerCase(), '']
                    : [p.slice(0, idx).trim().toLowerCase(), p.slice(idx + 1).trim()];
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
        pool: { min: 2, max: 10 },
    };
}

// ── Logger ───────────────────────────────────────────────────────────
const LOG_DIR = path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

export const LOG_DIR_PATH = LOG_DIR;

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.json()
    ),
    defaultMeta: { service: 'azure-alerts' },
    transports: [
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'azure-alerts.log'),
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
