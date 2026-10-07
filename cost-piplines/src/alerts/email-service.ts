import nodemailer from 'nodemailer';
import fs from 'node:fs';
import path from 'node:path';
import type { AlertReport, Alert, EmailResult, AlertSeverity, MeterBudgetAlert } from './types';
import { EMAIL_MODE, LOG_DIR_PATH, validateEmailEnvironment, logger } from './config';

function escapeHtml(value: string | number | null | undefined): string {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function formatCurrency(value: number | undefined | null, currency = 'INR'): string {
    if (value == null || !Number.isFinite(value)) return 'N/A';
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(value);
}

function formatNumber(value: number | undefined | null): string {
    if (value == null || !Number.isFinite(value)) return 'N/A';
    return new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 }).format(value);
}

function formatPercent(value: number | undefined | null): string {
    if (value == null || !Number.isFinite(value)) return 'N/A';
    return `${value.toFixed(2)}%`;
}

function formatAlertType(alertType: string): string {
    return String(alertType || "UNKNOWN_ALERT")
        .replaceAll("_", " ")
        .toLowerCase()
        .replace(/\b\w/g, (c) => c.toUpperCase());
}

function getSeverityColor(severity: string): string {
    switch (severity) {
        case "CRITICAL": return "#b91c1c";
        case "HIGH": return "#dc2626";
        case "WARNING": return "#d97706";
        case "INFO":
        default: return "#2563eb";
    }
}

function getAlertTitle(alert: Alert): string {
    switch (alert.alertType) {
        case "SUBSCRIPTION_COST_SPIKE": {
            const name = alert.subscriptionName?.trim();
            if (name && name.toLowerCase() !== 'unknown') return name;
            return alert.subscriptionId || "Subscription";
        }
        case "SERVICE_COST_SPIKE": return alert.service || "Azure service";
        case "RESOURCE_COST_SPIKE":
        case "NEW_EXPENSIVE_RESOURCE": return alert.resourceName || alert.resourceId || "Azure resource";
        case "QUANTITY_SPIKE": return [alert.resourceName, alert.meterName].filter(Boolean).join(" | ") || "Azure resource";
        default: return "Azure cost alert";
    }
}

function getHighestSeverity(alerts: Alert[]): AlertSeverity {
    const score: Record<AlertSeverity, number> = { CRITICAL: 4, HIGH: 3, WARNING: 2, INFO: 1 };
    let highest: AlertSeverity = 'INFO';
    for (const alert of alerts) {
        if (score[alert.severity] > score[highest]) {
            highest = alert.severity;
        }
    }
    return highest;
}

function renderAlertCard(a: Alert): string {
    const c = getSeverityColor(a.severity);
    const cur = a.billingCurrency || 'INR';
    const isQty = a.alertType === 'QUANTITY_SPIKE';
    const isNew = a.alertType === 'NEW_EXPENSIVE_RESOURCE';

    let metrics = '';
    if (isQty) {
        metrics = [
            `<tr><td style="color:#64748b;padding-right:12px;">Current quantity</td><td>${formatNumber(a.currentQuantity)} ${escapeHtml(a.unitOfMeasure)}</td></tr>`,
            `<tr><td style="color:#64748b;padding-right:12px;">Baseline quantity</td><td>${formatNumber(a.baselineQuantity)} ${escapeHtml(a.unitOfMeasure)}</td></tr>`,
            `<tr><td style="color:#64748b;padding-right:12px;">Increase</td><td>${formatPercent(a.percentIncrease)}</td></tr>`,
        ].join('');
    } else if (isNew) {
        metrics = [
            `<tr><td style="color:#64748b;padding-right:12px;">Current cost</td><td>${formatCurrency(a.currentCost, cur)}</td></tr>`,
            `<tr><td style="color:#64748b;padding-right:12px;">First seen</td><td>${escapeHtml(a.firstSeenDate)}</td></tr>`,
        ].join('');
    } else {
        metrics = [
            `<tr><td style="color:#64748b;padding-right:12px;">Current cost</td><td>${formatCurrency(a.currentCost, cur)}</td></tr>`,
            `<tr><td style="color:#64748b;padding-right:12px;">Baseline cost (${a.nonZeroBaselineDays || 7} days)</td><td>${formatCurrency(a.baselineCost, cur)}</td></tr>`,
            `<tr><td style="color:#64748b;padding-right:12px;">Absolute increase</td><td>${formatCurrency(a.absoluteIncrease, cur)}</td></tr>`,
            `<tr><td style="color:#64748b;padding-right:12px;">Percent increase</td><td>${formatPercent(a.percentIncrease)}</td></tr>`,
        ].join('');
    }

    let driver = '';
    if (a.likelyDrivenBy) {
        const driverName = escapeHtml(a.likelyDrivenBy.resourceName || a.likelyDrivenBy.service || a.likelyDrivenBy.alertType);
        const driverCoverage = formatPercent(a.likelyDrivenBy.coveragePercent);
        driver = `<p style="margin: 8px 0 0 0; font-size: 13px; color: #475569;"><strong>Likely driven by:</strong> ${driverName} (${driverCoverage} of increase)</p>`;
    }

    const ctx: string[] = [];
    if (a.subscriptionName) ctx.push(`Sub: ${a.subscriptionName}`);
    if (a.resourceGroup) ctx.push(`RG: ${a.resourceGroup}`);
    if (a.service) ctx.push(`Svc: ${a.service}`);

    return `
    <div style="border: 1px solid #e2e8f0; border-left: 5px solid ${c}; border-radius: 8px; margin-bottom: 16px; padding: 18px;">
        <div style="margin-bottom: 8px;">
            <span style="padding: 2px 8px; border-radius: 999px; background: ${c}; color: #fff; font-size: 12px; font-weight: bold;">${a.severity}</span>
            <span style="margin-left: 8px; color: #64748b; font-size: 13px;">${formatAlertType(a.alertType)}</span>
        </div>
        <h3 style="margin: 0 0 12px; font-size: 16px;">${escapeHtml(getAlertTitle(a))}</h3>
        <table style="font-size: 14px; width: 100%; text-align: left;">${metrics}</table>
        ${driver}
        <div style="margin-top: 12px; font-size: 12px; color: #94a3b8;">${escapeHtml(ctx.join(' | '))}</div>
    </div>`;
}

export function createEmailHtml(report: AlertReport): string {
    const { evaluationDate, summary, alerts = [] } = report;
    const highestSev = alerts.length > 0 ? getHighestSeverity(alerts) : 'INFO';
    const chips = ['subscriptionCostSpikes', 'serviceCostSpikes', 'resourceCostSpikes', 'newExpensiveResources', 'quantitySpikes']
        .map(k => `<span style="padding: 4px 8px; background: #f1f5f9; border-radius: 4px; font-size: 12px;">${k.replace(/[A-Z]/g, m => ' ' + m).toLowerCase()}: ${summary?.[k as keyof typeof summary] ?? 0}</span>`)
        .join('');

    const cards = alerts.map(renderAlertCard).join('');

    return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Azure Cost Alerts</title></head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: Arial, Helvetica, sans-serif;">
    <div style="max-width: 760px; margin: 0 auto; padding: 24px 12px;">
        <div style="border-radius: 10px; padding: 24px; background-color: #0f172a; color: #ffffff;">
            <h1 style="margin: 0 0 8px; font-size: 24px;">Azure Cost Alert Report</h1>
            <p style="margin: 0; color: #cbd5e1; font-size: 14px;">Evaluation date: ${escapeHtml(evaluationDate)} | Highest Severity: <span style="color: ${getSeverityColor(highestSev)}; font-weight: bold;">${highestSev}</span></p>
        </div>
        <div style="padding: 22px; border: 1px solid #e2e8f0; background-color: #ffffff;">
            <p style="margin-top: 0; color: #334155;">The alert engine detected <strong>${escapeHtml(summary?.total ?? alerts.length)}</strong> alerts.</p>
            <div style="display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap;">${chips}</div>
            ${cards}
        </div>
    </div>
</body>
</html>`;
}

export function createEmailText(report: AlertReport): string {
    const { evaluationDate, baselineDates = [], alerts = [] } = report;
    let text = `Azure Cost Alert Report\nEvaluation date: ${evaluationDate}\nBaseline dates: ${baselineDates.join(', ')}\nTotal alerts: ${alerts.length}\n`;

    alerts.forEach((a, i) => {
        text += `\n--- ALERT ${i + 1} ---\n[${a.severity}] ${formatAlertType(a.alertType)}\nTitle: ${getAlertTitle(a)}\n`;
        const cur = a.billingCurrency || 'INR';
        
        if (a.alertType === 'QUANTITY_SPIKE') {
            text += `Current quantity: ${formatNumber(a.currentQuantity)} ${a.unitOfMeasure || ''}\n`;
            text += `Baseline: ${formatNumber(a.baselineQuantity)} ${a.unitOfMeasure || ''}\n`;
            text += `Increase: ${formatPercent(a.percentIncrease)}\n`;
        } else if (a.alertType === 'NEW_EXPENSIVE_RESOURCE') {
            text += `Current cost: ${formatCurrency(a.currentCost, cur)}\n`;
            text += `First seen: ${a.firstSeenDate}\n`;
        } else {
            text += `Current cost: ${formatCurrency(a.currentCost, cur)}\n`;
            text += `Baseline: ${formatCurrency(a.baselineCost, cur)}\n`;
            text += `Absolute increase: ${formatCurrency(a.absoluteIncrease, cur)}\n`;
            text += `Increase: ${formatPercent(a.percentIncrease)}\n`;
        }
        
        if (a.likelyDrivenBy) {
            text += `Likely driven by: ${a.likelyDrivenBy.resourceName || a.likelyDrivenBy.service} (${formatPercent(a.likelyDrivenBy.coveragePercent * 100)})\n`;
        }
        
        const ctx = [];
        if (a.subscriptionName) ctx.push(a.subscriptionName);
        if (a.resourceGroup) ctx.push(a.resourceGroup);
        if (a.service) ctx.push(a.service);
        if (ctx.length) text += `Context: ${ctx.join(' | ')}\n`;
    });

    return text;
}

export async function sendAlertEmail(alertReport: AlertReport, options?: { mode?: 'preview' | 'send' }): Promise<EmailResult> {
    if (!alertReport.alerts || alertReport.alerts.length === 0) {
        return { sent: false, reason: 'NO_ALERTS' };
    }

    const mode = options?.mode || EMAIL_MODE;

    if (mode === 'preview') {
        const previewHtml = createEmailHtml(alertReport);
        const previewPath = path.join(LOG_DIR_PATH, `alert-preview-${alertReport.evaluationDate}.html`);
        fs.writeFileSync(previewPath, previewHtml, 'utf8');
        logger.info(`Wrote email preview to ${previewPath}`);
        return { sent: false, previewed: true, previewPath };
    }

    validateEmailEnvironment();

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        },
    });

    try {
        await transporter.verify();
    } catch (err) {
        logger.error('Failed to verify SMTP connection', { error: err });
        throw err;
    }

    const highestSeverity = getHighestSeverity(alertReport.alerts);
    const subject = `[${highestSeverity}] Azure Cost Alerts: ${alertReport.alerts.length} detected on ${alertReport.evaluationDate}`;

    const mailOptions = {
        from: process.env.ALERT_EMAIL_FROM,
        to: process.env.ALERT_EMAIL_TO,
        subject,
        text: createEmailText(alertReport),
        html: createEmailHtml(alertReport),
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return {
            sent: true,
            messageId: info.messageId,
            accepted: info.accepted as string[],
            rejected: info.rejected as string[],
        };
    } catch (err: any) {
        logger.error('Failed to send alert email', { error: err });
        throw err;
    }
}

export function createBudgetAlertHtml(budgetAlerts: MeterBudgetAlert[]): string {
    const rows = budgetAlerts.map((ba) => {
        const isOver = ba.thresholdCrossed === 'OVER_BUDGET';
        const color = isOver ? '#b91c1c' : ba.thresholdCrossed === '100%' ? '#dc2626' : ba.thresholdCrossed === '75%' ? '#d97706' : '#2563eb';
        return `
        <div style="border:1px solid #e2e8f0;border-left:4px solid ${color};border-radius:6px;padding:16px;margin-bottom:16px;background:#ffffff;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                <h3 style="margin:0;font-size:16px;color:#0f172a;">${escapeHtml(ba.budget.meterName)}</h3>
                <span style="background:${color};color:#ffffff;padding:3px 8px;border-radius:4px;font-size:12px;font-weight:600;">${ba.thresholdCrossed} REACHED</span>
            </div>
            <p style="margin:4px 0;font-size:13px;color:#64748b;">
                Category: <strong>${escapeHtml(ba.budget.meterCategory || 'N/A')}</strong> | Service: <strong>${escapeHtml(ba.budget.service || 'N/A')}</strong>
            </p>
            <table style="width:100%;font-size:13px;margin-top:12px;border-collapse:collapse;">
                <tr><td style="color:#64748b;padding:4px 0;">Current Month Spend:</td><td style="font-weight:600;">${formatCurrency(ba.currentMonthSpend, ba.budget.billingCurrency)}</td></tr>
                <tr><td style="color:#64748b;padding:4px 0;">Monthly Budget Limit:</td><td style="font-weight:600;">${formatCurrency(ba.budgetLimit, ba.budget.billingCurrency)}</td></tr>
                <tr><td style="color:#64748b;padding:4px 0;">Budget Consumed:</td><td style="font-weight:700;color:${color};">${ba.percentUsed.toFixed(1)}%</td></tr>
            </table>
        </div>`;
    }).join('');

    return `<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;padding:24px;color:#1e293b;">
    <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:8px;padding:24px;">
        <h2 style="margin-top:0;color:#0f172a;">Azure Meter Budget Alert Notification</h2>
        <p style="color:#64748b;font-size:14px;">The following Azure meters have reached or exceeded their configured budget thresholds:</p>
        ${rows}
        <p style="font-size:12px;color:#94a3b8;margin-top:24px;border-top:1px solid #f1f5f9;padding-top:12px;">Automated Cloud Cost Intelligence Alert</p>
    </div>
    </body></html>`;
}

export async function sendBudgetAlertEmail(budgetAlerts: MeterBudgetAlert[], options?: { mode?: 'preview' | 'send' }): Promise<EmailResult> {
    if (!budgetAlerts || budgetAlerts.length === 0) {
        return { sent: false, reason: 'NO_ALERTS' };
    }

    const mode = options?.mode || EMAIL_MODE;
    const dateStr = budgetAlerts[0]?.evaluationDate || new Date().toISOString().slice(0, 10);

    if (mode === 'preview') {
        const previewHtml = createBudgetAlertHtml(budgetAlerts);
        const previewPath = path.join(LOG_DIR_PATH, `budget-alert-preview-${dateStr}.html`);
        fs.writeFileSync(previewPath, previewHtml, 'utf8');
        logger.info(`Wrote budget alert preview to ${previewPath}`);
        return { sent: false, previewed: true, previewPath };
    }

    validateEmailEnvironment();

    const transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT),
        secure: String(process.env.SMTP_SECURE).toLowerCase() === 'true',
        auth: {
            user: process.env.SMTP_USER,
            pass: process.env.SMTP_PASSWORD,
        },
    });

    const recipientSet = new Set<string>();
    for (const ba of budgetAlerts) {
        if (ba.budget.alertEmail) recipientSet.add(ba.budget.alertEmail);
    }
    const recipients = Array.from(recipientSet).length > 0
        ? Array.from(recipientSet).join(',')
        : (process.env.ALERT_EMAIL_TO || '');

    const subject = `[BUDGET ALERT] ${budgetAlerts.length} Azure Meter(s) reached budget thresholds (${dateStr})`;

    const mailOptions = {
        from: process.env.ALERT_EMAIL_FROM,
        to: recipients,
        subject,
        html: createBudgetAlertHtml(budgetAlerts),
    };

    try {
        const info = await transporter.sendMail(mailOptions);
        return {
            sent: true,
            messageId: info.messageId,
            accepted: info.accepted as string[],
            rejected: info.rejected as string[],
        };
    } catch (err: any) {
        logger.error('Failed to send budget alert email', { error: err });
        throw err;
    }
}

