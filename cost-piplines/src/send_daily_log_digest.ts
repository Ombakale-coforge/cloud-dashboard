/**
 * Daily Pipeline Logging & Application-Wide Email Audit Digest
 *
 * Compiles the rolling 24-hour window (or a specific --date=YYYY-MM-DD) of:
 *   1. Daily pipeline runs & full raw stdout/stderr logs
 *   2. Every outbound email sent across the application (reports, budgets, bursts, requests, alerts)
 *
 * Usage:
 *   tsx src/send_daily_log_digest.ts                  # Last 24h, send email + prune expired logs
 *   tsx src/send_daily_log_digest.ts --dry-run        # Write preview HTML without sending
 *   tsx src/send_daily_log_digest.ts --hours=48       # Custom lookback window in hours
 *   tsx src/send_daily_log_digest.ts --date=2026-11-25
 *   tsx src/send_daily_log_digest.ts --to=ops@co.com
 *   tsx src/send_daily_log_digest.ts --no-attach
 */

import dotenv from 'dotenv';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAuditDir,
  pruneOldAuditFiles,
  readAuditWindow,
  type EmailAuditRecord,
  type PipelineRunRecord,
} from './logging/auditLogger.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

dotenv.config({ path: path.resolve(ROOT_DIR, '.env') });

export const EXPECTED_DAILY_JOBS = [
  'daily-data-refresh',
  'daily-cost-report-email',
  'azure-daily-cost-burst-alerts',
] as const;

// ponytail: Microsoft Graph sendMail caps total inline request ~3-4MB (~33% base64 overhead); use upload sessions if logs ever need >1.5MB attached.
export const MAX_TOTAL_ATTACHMENT_BYTES = Math.floor(1.5 * 1024 * 1024);

export type DigestHealthStatus = 'ALL HEALTHY' | 'WARNINGS' | 'ACTION REQUIRED';

export interface DigestAttachmentItem {
  filename: string;
  content: string;
  contentType: string;
  jobName: string;
  lineCount: number;
  originalBytes: number;
  attachedBytes: number;
  trimmed: boolean;
  serverPath: string;
}

export interface DailyLogDigestResult {
  healthStatus: DigestHealthStatus;
  subject: string;
  html: string;
  text: string;
  attachments: DigestAttachmentItem[];
  summary: {
    expectedJobsCount: number;
    passedJobsCount: number;
    missingJobs: string[];
    failedRunsCount: number;
    totalWarnings: number;
    appEmailsSent: number;
    appEmailsFailed: number;
    appEmailsTotal: number;
  };
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}s`;
  const min = Math.floor(sec / 60);
  const rem = Math.round(sec % 60);
  return `${min}m ${rem}s`;
}

function formatShortTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}

export function trimLogForAttachment(
  content: string,
  maxBytes: number,
  serverPath: string
): { content: string; trimmed: boolean } {
  const totalBytes = Buffer.byteLength(content, 'utf8');
  if (totalBytes <= maxBytes) {
    return { content, trimmed: false };
  }

  const notice = `\n\n... [LOG TRIMMED TO FIT EMAIL ATTACHMENT LIMIT (${formatBytes(maxBytes)}) — FULL LOG ON SERVER: ${serverPath}] ...\n\n`;
  const noticeBytes = Buffer.byteLength(notice, 'utf8');

  if (maxBytes <= noticeBytes + 128) {
    const truncated = Buffer.from(content, 'utf8').subarray(0, Math.max(0, maxBytes)).toString('utf8');
    return { content: truncated, trimmed: true };
  }

  const available = maxBytes - noticeBytes;
  const headBudget = Math.floor(available * 0.25);
  const tailBudget = available - headBudget;

  const buf = Buffer.from(content, 'utf8');
  const headText = buf.subarray(0, headBudget).toString('utf8');
  const tailText = buf.subarray(Math.max(headBudget, buf.length - tailBudget)).toString('utf8');

  // Snap cleanly to line boundaries when possible
  const lastNewlineInHead = headText.lastIndexOf('\n');
  const cleanHead = lastNewlineInHead > 0 ? headText.slice(0, lastNewlineInHead) : headText;
  const firstNewlineInTail = tailText.indexOf('\n');
  const cleanTail = firstNewlineInTail >= 0 && firstNewlineInTail < tailText.length - 1
    ? tailText.slice(firstNewlineInTail + 1)
    : tailText;

  return {
    content: `${cleanHead}${notice}${cleanTail}`,
    trimmed: true,
  };
}

export function buildDailyLogDigest(params: {
  runs: PipelineRunRecord[];
  emails: EmailAuditRecord[];
  windowStart: Date;
  windowEnd: Date;
  auditDir: string;
  attachLogs?: boolean;
}): DailyLogDigestResult {
  const { runs, emails, windowStart, windowEnd, auditDir, attachLogs = true } = params;

  // Exclude self-referential digest records from application email stats
  const appEmails = emails.filter((e) => e.category !== 'ops-log-digest');
  const liveRuns = runs.filter((r) => !r.dryRun);

  const missingJobs = EXPECTED_DAILY_JOBS.filter(
    (job) => !liveRuns.some((r) => r.jobName === job)
  );
  const failedRuns = liveRuns.filter((r) => r.status === 'FAIL');
  const passedJobsCount = EXPECTED_DAILY_JOBS.filter((job) => {
    const jobRuns = liveRuns.filter((r) => r.jobName === job);
    return jobRuns.length > 0 && jobRuns[jobRuns.length - 1].status === 'PASS';
  }).length;

  const totalWarnings = liveRuns.reduce((sum, r) => sum + (r.warnCount || 0), 0);
  const appEmailsSent = appEmails.filter((e) => e.status === 'sent').length;
  const appEmailsFailed = appEmails.filter((e) => e.status === 'failed').length;

  let healthStatus: DigestHealthStatus = 'ALL HEALTHY';
  if (failedRuns.length > 0 || missingJobs.length > 0 || appEmailsFailed > 0) {
    healthStatus = 'ACTION REQUIRED';
  } else if (totalWarnings > 0) {
    healthStatus = 'WARNINGS';
  }

  const dateLabel = windowEnd.toISOString().slice(0, 10);
  const subject = `[FinOps Daily Log — ${healthStatus}] ${dateLabel} | ${passedJobsCount}/${EXPECTED_DAILY_JOBS.length} Pipelines OK | ${appEmailsSent} Emails Sent`;

  // Prepare raw log attachments within combined budget
  const attachments: DigestAttachmentItem[] = [];
  if (attachLogs && runs.length > 0) {
    const perRunBudget = Math.max(
      32 * 1024,
      Math.floor(MAX_TOTAL_ATTACHMENT_BYTES / runs.length)
    );
    let remainingBudget = MAX_TOTAL_ATTACHMENT_BYTES;

    for (const run of runs) {
      const serverPath = path.isAbsolute(run.logFile)
        ? run.logFile
        : path.join(auditDir, run.logFile);
      if (!fs.existsSync(serverPath) || remainingBudget <= 0) continue;

      try {
        const rawContent = fs.readFileSync(serverPath, 'utf8');
        const originalBytes = Buffer.byteLength(rawContent, 'utf8');
        const budget = Math.min(perRunBudget, remainingBudget);
        const { content, trimmed } = trimLogForAttachment(rawContent, budget, serverPath);
        const attachedBytes = Buffer.byteLength(content, 'utf8');
        remainingBudget = Math.max(0, remainingBudget - attachedBytes);

        const base = path.basename(run.logFile, '.log');
        attachments.push({
          filename: `${base}.txt`,
          content,
          contentType: 'text/plain; charset=utf-8',
          jobName: run.jobName,
          lineCount: run.lineCount,
          originalBytes,
          attachedBytes,
          trimmed,
          serverPath,
        });
      } catch {
        // Ignore unreadable log files
      }
    }
  }

  const statusMeta =
    healthStatus === 'ACTION REQUIRED'
      ? { bg: '#fef2f2', border: '#ef4444', badgeBg: '#dc2626', text: '#991b1b' }
      : healthStatus === 'WARNINGS'
      ? { bg: '#fffbeb', border: '#f59e0b', badgeBg: '#d97706', text: '#92400e' }
      : { bg: '#f0fdf4', border: '#22c55e', badgeBg: '#16a34a', text: '#166534' };

  const statusBadge = (status: string): string => {
    if (status === 'PASS' || status === 'sent') {
      return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#dcfce7;color:#166534;font-weight:700;font-size:11px;">' + escapeHtml(status) + '</span>';
    }
    if (status === 'FAIL' || status === 'failed' || status === 'MISSING') {
      return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#fee2e2;color:#991b1b;font-weight:700;font-size:11px;">' + escapeHtml(status) + '</span>';
    }
    return '<span style="display:inline-block;padding:2px 8px;border-radius:4px;background:#fef3c7;color:#92400e;font-weight:700;font-size:11px;">' + escapeHtml(status) + '</span>';
  };

  // Build Pipeline Runs rows
  const missingRowsHtml = missingJobs
    .map(
      (job) => `
      <tr style="background:#fef2f2;border-bottom:1px solid #fecaca;">
        <td style="padding:10px;font-weight:700;color:#991b1b;">${escapeHtml(job)}</td>
        <td style="padding:10px;">${statusBadge('MISSING')}</td>
        <td style="padding:10px;color:#64748b;">—</td>
        <td style="padding:10px;color:#64748b;">—</td>
        <td style="padding:10px;color:#991b1b;font-size:12px;" colspan="2">Expected daily cron job did not run in this window. Check PM2 / server logs.</td>
      </tr>`
    )
    .join('');

  const runRowsHtml = runs
    .map((run) => {
      const stepsHtml =
        run.steps && run.steps.length > 0
          ? `<div style="margin-top:6px;padding-left:10px;border-left:2px solid #cbd5e1;">${run.steps
              .map(
                (s) =>
                  `<div style="font-size:11.5px;color:#334155;margin:2px 0;">${statusBadge(s.status)} <strong>${escapeHtml(s.label)}</strong> <span style="color:#64748b;">(${escapeHtml(s.durationSec)}s)</span>${s.detail ? ` — <span style="color:#475569;">${escapeHtml(s.detail)}</span>` : ''}</div>`
              )
              .join('')}</div>`
          : '';

      const highlightsHtml =
        run.errorHighlights && run.errorHighlights.length > 0
          ? `<div style="margin-top:8px;background:#0f172a;color:#f8fafc;padding:8px 10px;border-radius:6px;font-family:Consolas,Monaco,monospace;font-size:11px;line-height:1.45;white-space:pre-wrap;word-break:break-word;">${run.errorHighlights
              .map((line) => escapeHtml(line))
              .join('\n')}</div>`
          : '';

      return `
      <tr style="border-bottom:1px solid #e2e8f0;vertical-align:top;">
        <td style="padding:10px;">
          <div style="font-weight:700;color:#0f172a;">${escapeHtml(run.jobName)}${run.dryRun ? ' <span style="font-size:10px;color:#64748b;font-weight:500;">(dry-run)</span>' : ''}</div>
          ${run.summaryNote ? `<div style="font-size:11px;color:#475569;margin-top:2px;">${escapeHtml(run.summaryNote)}</div>` : ''}
          ${stepsHtml}
          ${highlightsHtml}
        </td>
        <td style="padding:10px;white-space:nowrap;">${statusBadge(run.status)}</td>
        <td style="padding:10px;font-size:12px;color:#475569;white-space:nowrap;">${escapeHtml(formatShortTime(run.startedAt))}</td>
        <td style="padding:10px;font-size:12px;color:#0f172a;white-space:nowrap;">${escapeHtml(formatDuration(run.durationMs))}</td>
        <td style="padding:10px;font-size:12px;white-space:nowrap;">
          <span style="color:${run.errorCount > 0 ? '#dc2626' : '#64748b'};font-weight:${run.errorCount > 0 ? '700' : '400'};">${run.errorCount} err</span>
          /
          <span style="color:${run.warnCount > 0 ? '#d97706' : '#64748b'};font-weight:${run.warnCount > 0 ? '700' : '400'};">${run.warnCount} warn</span>
        </td>
        <td style="padding:10px;font-size:12px;color:#475569;white-space:nowrap;">${run.lineCount} lines (${escapeHtml(formatBytes(run.logBytes))})</td>
      </tr>`;
    })
    .join('');

  // Category breakdown pills for emails
  const categoryCounts = new Map<string, number>();
  for (const e of appEmails) {
    categoryCounts.set(e.category, (categoryCounts.get(e.category) || 0) + 1);
  }
  const categoryPillsHtml = Array.from(categoryCounts.entries())
    .map(
      ([cat, count]) =>
        `<span style="display:inline-block;margin:0 6px 6px 0;padding:3px 9px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:999px;font-size:11px;color:#334155;"><strong>${escapeHtml(cat)}</strong>: ${count}</span>`
    )
    .join('');

  const emailRowsHtml =
    appEmails.length > 0
      ? appEmails
          .map(
            (e) => `
        <tr style="border-bottom:1px solid #e2e8f0;vertical-align:top;">
          <td style="padding:8px 10px;font-size:11.5px;color:#475569;white-space:nowrap;">${escapeHtml(formatShortTime(e.timestamp))}</td>
          <td style="padding:8px 10px;font-size:12px;font-weight:600;color:#0f172a;white-space:nowrap;">${escapeHtml(e.category)}</td>
          <td style="padding:8px 10px;white-space:nowrap;">${statusBadge(e.status)}</td>
          <td style="padding:8px 10px;font-size:12px;color:#475569;white-space:nowrap;">${escapeHtml(e.transport)}</td>
          <td style="padding:8px 10px;font-size:12px;color:#334155;word-break:break-word;">
            ${escapeHtml(e.to.join(', '))}
            ${e.cc && e.cc.length > 0 ? `<div style="font-size:11px;color:#64748b;">CC: ${escapeHtml(e.cc.join(', '))}</div>` : ''}
          </td>
          <td style="padding:8px 10px;font-size:12px;color:#0f172a;">
            ${escapeHtml(e.subject)}
            ${e.attachments && e.attachments.length > 0 ? `<div style="font-size:11px;color:#64748b;margin-top:2px;">📎 ${escapeHtml(e.attachments.join(', '))}</div>` : ''}
            ${e.error ? `<div style="font-size:11px;color:#dc2626;margin-top:2px;">Error: ${escapeHtml(e.error)}</div>` : ''}
          </td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="6" style="padding:14px;text-align:center;color:#64748b;font-size:13px;">No application emails recorded in this window.</td></tr>`;

  const attachmentsHtml =
    attachments.length > 0
      ? attachments
          .map(
            (a) => `
        <tr style="border-bottom:1px solid #e2e8f0;">
          <td style="padding:7px 10px;font-family:Consolas,Monaco,monospace;font-size:11.5px;color:#0f172a;">${escapeHtml(a.filename)}</td>
          <td style="padding:7px 10px;font-size:12px;color:#334155;">${escapeHtml(a.jobName)}</td>
          <td style="padding:7px 10px;font-size:12px;color:#475569;">${a.lineCount} lines</td>
          <td style="padding:7px 10px;font-size:12px;color:#475569;">${escapeHtml(formatBytes(a.attachedBytes))}${a.trimmed ? ` (trimmed from ${escapeHtml(formatBytes(a.originalBytes))})` : ''}</td>
        </tr>`
          )
          .join('')
      : `<tr><td colspan="4" style="padding:12px;text-align:center;color:#64748b;font-size:12px;">No raw log attachments included.</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',-apple-system,BlinkMacSystemFont,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="padding:24px 12px;">
    <div style="max-width:920px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;padding:24px;">
      <!-- Header Banner -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background:linear-gradient(135deg,#090d16 0%,#0f172a 60%,#1e293b 100%);color:#ffffff;border-radius:10px;padding:18px 22px;margin-bottom:18px;">
        <tr>
          <td align="left" style="vertical-align:middle;">
            <div style="font-size:19px;font-weight:800;color:#ffffff;">FinOps Daily Pipeline &amp; Email Audit Digest</div>
            <div style="font-size:12px;color:#94a3b8;margin-top:4px;">
              Window: ${escapeHtml(formatShortTime(windowStart.toISOString()))} &rarr; ${escapeHtml(formatShortTime(windowEnd.toISOString()))}
              &bull; Host: ${escapeHtml(os.hostname())} (${escapeHtml(process.env.NODE_ENV || 'development')})
            </div>
          </td>
          <td align="right" style="vertical-align:middle;">
            <span style="display:inline-block;background:${statusMeta.badgeBg};color:#ffffff;font-weight:800;font-size:12px;padding:6px 12px;border-radius:6px;letter-spacing:0.4px;">
              ${escapeHtml(healthStatus)}
            </span>
          </td>
        </tr>
      </table>

      <!-- Status Callout -->
      <div style="background:${statusMeta.bg};border:1px solid ${statusMeta.border};color:${statusMeta.text};padding:12px 14px;border-radius:8px;font-size:13px;margin-bottom:18px;">
        <strong>Daily Health Check:</strong>
        ${
          healthStatus === 'ALL HEALTHY'
            ? `All ${EXPECTED_DAILY_JOBS.length} expected daily pipelines ran and succeeded, and ${appEmailsSent} outbound email(s) were delivered with zero errors or warnings.`
            : healthStatus === 'WARNINGS'
            ? `All ${EXPECTED_DAILY_JOBS.length} expected daily pipelines succeeded with ${totalWarnings} warning(s) logged. Review highlights below.`
            : `${failedRuns.length} failed pipeline run(s), ${missingJobs.length} missing expected pipeline(s), and ${appEmailsFailed} failed email(s) detected.`
        }
      </div>

      <!-- 4 KPI Cards -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px;border-collapse:separate;border-spacing:10px 0;">
        <tr>
          <td width="25%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Pipelines OK</div>
            <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:4px;">${passedJobsCount} / ${EXPECTED_DAILY_JOBS.length}</div>
          </td>
          <td width="25%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Failed / Missing</div>
            <div style="font-size:22px;font-weight:800;color:${failedRuns.length + missingJobs.length > 0 ? '#dc2626' : '#16a34a'};margin-top:4px;">${failedRuns.length} / ${missingJobs.length}</div>
          </td>
          <td width="25%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">App Emails Sent</div>
            <div style="font-size:22px;font-weight:800;color:#0f172a;margin-top:4px;">${appEmailsSent} <span style="font-size:12px;color:#64748b;font-weight:500;">(${appEmails.length} total)</span></div>
          </td>
          <td width="25%" style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;">
            <div style="font-size:11px;color:#64748b;text-transform:uppercase;font-weight:700;">Failed Emails / Warn</div>
            <div style="font-size:22px;font-weight:800;color:${appEmailsFailed > 0 ? '#dc2626' : totalWarnings > 0 ? '#d97706' : '#16a34a'};margin-top:4px;">${appEmailsFailed} / ${totalWarnings}</div>
          </td>
        </tr>
      </table>

      <!-- Section 1: Daily Pipeline Runs -->
      <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
        1. Daily Pipeline Runs (${runs.length} recorded${missingJobs.length > 0 ? `, ${missingJobs.length} missing` : ''})
      </h2>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:22px;font-size:13px;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
            <th style="padding:9px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Pipeline &amp; Steps</th>
            <th style="padding:9px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Status</th>
            <th style="padding:9px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Started</th>
            <th style="padding:9px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Duration</th>
            <th style="padding:9px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Err / Warn</th>
            <th style="padding:9px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Log Size</th>
          </tr>
        </thead>
        <tbody>
          ${missingRowsHtml}
          ${runRowsHtml || (!missingRowsHtml ? '<tr><td colspan="6" style="padding:14px;text-align:center;color:#64748b;">No pipeline runs recorded in this window.</td></tr>' : '')}
        </tbody>
      </table>

      <!-- Section 2: Application Emails Sent -->
      <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
        2. Application Emails Sent (Whole App — ${appEmails.length} event${appEmails.length === 1 ? '' : 's'})
      </h2>
      ${categoryPillsHtml ? `<div style="margin-bottom:10px;">${categoryPillsHtml}</div>` : ''}
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;margin-bottom:22px;font-size:12.5px;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Time</th>
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Category</th>
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Status</th>
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Transport</th>
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Recipients</th>
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Subject &amp; Details</th>
          </tr>
        </thead>
        <tbody>
          ${emailRowsHtml}
        </tbody>
      </table>

      <!-- Section 3: Attached Raw Logs -->
      <h2 style="margin:0 0 10px;font-size:15px;font-weight:700;color:#0f172a;border-bottom:2px solid #e2e8f0;padding-bottom:6px;">
        3. Attached Raw Pipeline Logs (${attachments.length} file${attachments.length === 1 ? '' : 's'})
      </h2>
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;border:1px solid #e2e8f0;font-size:12.5px;">
        <thead>
          <tr style="background:#f8fafc;border-bottom:1px solid #e2e8f0;text-align:left;">
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Attachment</th>
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Job</th>
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Lines</th>
            <th style="padding:8px 10px;font-size:11px;color:#475569;text-transform:uppercase;">Attached Size</th>
          </tr>
        </thead>
        <tbody>
          ${attachmentsHtml}
        </tbody>
      </table>

      <div style="margin-top:20px;padding-top:12px;border-top:1px solid #e2e8f0;text-align:center;font-size:11px;color:#64748b;">
        Coforge Cloud Cost Intelligence &bull; Daily Ops Logging &amp; Email Audit Digest &bull; Audit Dir: ${escapeHtml(auditDir)}
      </div>
    </div>
  </div>
</body>
</html>`;

  const textLines: string[] = [
    subject,
    `Window: ${windowStart.toISOString()} -> ${windowEnd.toISOString()}`,
    `Pipelines OK: ${passedJobsCount}/${EXPECTED_DAILY_JOBS.length} | Failed: ${failedRuns.length} | Missing: ${missingJobs.length}`,
    `App Emails: ${appEmailsSent} sent, ${appEmailsFailed} failed (${appEmails.length} total)`,
    '',
    '--- Pipeline Runs ---',
    ...missingJobs.map((j) => `[MISSING] ${j}`),
    ...runs.map(
      (r) =>
        `[${r.status}] ${r.jobName} (${formatDuration(r.durationMs)}, ${r.errorCount} err, ${r.warnCount} warn, ${r.lineCount} lines)`
    ),
    '',
    '--- Application Emails ---',
    ...appEmails.map(
      (e) =>
        `[${e.status}] ${e.timestamp} | ${e.category} | ${e.transport} | to=${e.to.join(',')} | ${e.subject}${e.error ? ` | err=${e.error}` : ''}`
    ),
  ];

  return {
    healthStatus,
    subject,
    html,
    text: textLines.join('\n'),
    attachments,
    summary: {
      expectedJobsCount: EXPECTED_DAILY_JOBS.length,
      passedJobsCount,
      missingJobs,
      failedRunsCount: failedRuns.length,
      totalWarnings,
      appEmailsSent,
      appEmailsFailed,
      appEmailsTotal: appEmails.length,
    },
  };
}

function readFlagValue(args: string[], prefix: string): string | undefined {
  const inline = args.find((a) => a.startsWith(`${prefix}=`));
  if (inline) return inline.slice(prefix.length + 1).trim();
  const idx = args.indexOf(prefix);
  return idx >= 0 && args[idx + 1] && !args[idx + 1].startsWith('--') ? args[idx + 1].trim() : undefined;
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const dateStr = readFlagValue(args, '--date');
  if (dateStr && !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Invalid --date "${dateStr}". Expected YYYY-MM-DD format.`);
  }

  const hoursRaw = readFlagValue(args, '--hours');
  const hours = hoursRaw ? Number(hoursRaw) : 24;
  if (!Number.isFinite(hours) || hours <= 0) {
    throw new Error(`Invalid --hours "${hoursRaw}". Expected a positive number.`);
  }

  return {
    dateStr,
    hours,
    toOverride: readFlagValue(args, '--to'),
    dryRun: args.includes('--dry-run') || args.includes('--preview'),
    noAttach: args.includes('--no-attach'),
  };
}

async function main(): Promise<void> {
  let exitCode = 0;
  let prismaModule: { prisma?: any } | null = null;

  try {
    const opts = parseCliArgs();
    const auditDir = getAuditDir();

    let windowEnd = new Date();
    let windowStart = new Date(windowEnd.getTime() - opts.hours * 3_600_000);
    if (opts.dateStr) {
      windowStart = new Date(`${opts.dateStr}T00:00:00.000Z`);
      windowEnd = new Date(`${opts.dateStr}T23:59:59.999Z`);
    }

    const { runs, emails } = readAuditWindow(windowStart.getTime(), windowEnd.getTime());
    const digest = buildDailyLogDigest({
      runs,
      emails,
      windowStart,
      windowEnd,
      auditDir,
      attachLogs: !opts.noAttach,
    });

    const recipientRaw =
      opts.toOverride ||
      process.env.LOG_DIGEST_EMAIL_TO ||
      process.env.ADMIN_EMAIL ||
      '';
    const recipients = recipientRaw
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);

    if (recipients.length === 0) {
      throw new Error(
        'No recipient configured. Set LOG_DIGEST_EMAIL_TO (or ADMIN_EMAIL) in .env, or pass --to=email@domain.com.'
      );
    }

    const dateTag = windowEnd.toISOString().slice(0, 10);
    const previewFilename = `digest-preview-${dateTag}.html`;

    // Lazy-import accountBudgetService (and db) only when sending/rendering preview
    const [{ deliverHtmlEmail }, dbMod] = await Promise.all([
      import('./server/services/accountBudgetService.ts'),
      import('./server/db.ts'),
    ]);
    prismaModule = dbMod;

    const delivery = await deliverHtmlEmail({
      recipients,
      subject: digest.subject,
      html: digest.html,
      text: digest.text,
      previewFilename,
      dryRun: opts.dryRun,
      attachments: digest.attachments.map((a) => ({
        filename: a.filename,
        content: a.content,
        contentType: a.contentType,
      })),
      auditCategory: 'ops-log-digest',
      auditSource: 'send_daily_log_digest',
    });

    if (opts.dryRun) {
      if (!fs.existsSync(auditDir)) fs.mkdirSync(auditDir, { recursive: true });
      const auditPreviewPath = path.join(auditDir, previewFilename);
      fs.writeFileSync(auditPreviewPath, digest.html, 'utf8');
      console.log(`[DailyLogDigest] DRY-RUN preview written: ${auditPreviewPath}`);
    }

    console.log(
      `[DailyLogDigest] Status=${digest.healthStatus} | Pipelines=${digest.summary.passedJobsCount}/${digest.summary.expectedJobsCount} (missing=${digest.summary.missingJobs.length}, failed=${digest.summary.failedRunsCount}) | ` +
        `AppEmails=${digest.summary.appEmailsSent}/${digest.summary.appEmailsTotal} (failed=${digest.summary.appEmailsFailed}) | ` +
        `Attachments=${digest.attachments.length} | Transport=${delivery.transport} | Sent=${delivery.sent}`
    );

    if (!opts.dryRun) {
      const retentionDays = Number(process.env.LOG_RETENTION_DAYS || '14');
      const pruned = pruneOldAuditFiles(retentionDays);
      if (pruned.deletedCount > 0) {
        console.log(`[DailyLogDigest] Pruned ${pruned.deletedCount} expired audit file(s) (> ${retentionDays}d).`);
      }

      if (!delivery.sent) {
        console.error(`[DailyLogDigest] Delivery failed: ${delivery.error || 'Unknown transport error'}`);
        exitCode = 1;
      }
    }
  } catch (err: any) {
    console.error('[DailyLogDigest] Fatal error:', err?.message || err);
    exitCode = 1;
  } finally {
    if (typeof prismaModule?.prisma?.$disconnect === 'function') {
      await prismaModule.prisma.$disconnect().catch(() => {});
    }
    process.exit(exitCode);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
