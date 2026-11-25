import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  pruneOldAuditFiles,
  readAuditWindow,
  recordEmailAudit,
  runChildWithCapture,
  startPipelineRunCapture,
  type EmailAuditRecord,
  type PipelineRunRecord,
} from './auditLogger.ts';
import {
  buildDailyLogDigest,
  EXPECTED_DAILY_JOBS,
  trimLogForAttachment,
} from '../send_daily_log_digest.ts';

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finops-audit-test-'));
  const prevAuditDir = process.env.AUDIT_LOG_DIR;
  process.env.AUDIT_LOG_DIR = tmpDir;

  try {
    // 1. Test startPipelineRunCapture + runChildWithCapture
    const capture = startPipelineRunCapture('daily-data-refresh', {
      command: 'tsx src/seed_all.ts',
    });

    console.log('\x1b[32m[Parent] Starting pipeline capture test\x1b[0m');
    console.warn('⚠️ [Parent] Sample warning message');

    await runChildWithCapture(process.execPath, [
      '-e',
      [
        'console.log("\\x1b[36m[Child] Step 1 complete\\x1b[0m");',
        'console.error("[Child] Simulated stderr error line");',
      ].join(' '),
    ]);

    const finishedRun = capture.finish({
      exitCode: 0,
      steps: [
        { id: 's1', label: 'Step 1', status: 'PASS', durationSec: '0.2' },
      ],
    });

    assert.ok(finishedRun, 'finish() should return PipelineRunRecord');
    assert.strictEqual(finishedRun.status, 'PASS');
    assert.ok(finishedRun.warnCount >= 1, `Expected warnCount >= 1, got ${finishedRun.warnCount}`);
    assert.ok(finishedRun.errorCount >= 1, `Expected errorCount >= 1, got ${finishedRun.errorCount}`);
    assert.ok(finishedRun.lineCount >= 4, `Expected lineCount >= 4, got ${finishedRun.lineCount}`);

    const rawLogFullPath = path.join(tmpDir, finishedRun.logFile);
    assert.ok(fs.existsSync(rawLogFullPath), 'Raw log file must exist');
    const rawLogText = fs.readFileSync(rawLogFullPath, 'utf8');
    assert.ok(!rawLogText.includes('\x1b['), 'ANSI escape sequences must be stripped');
    assert.ok(rawLogText.includes('[Parent] Starting pipeline capture test'), 'Parent stdout must be captured');
    assert.ok(rawLogText.includes('[Child] Step 1 complete'), 'Child stdout must be captured');
    assert.ok(rawLogText.includes('[Child] Simulated stderr error line'), 'Child stderr must be captured');

    // 2. Test recordEmailAudit + readAuditWindow
    const now = Date.now();
    const oldIso = new Date(now - 3 * 86_400_000).toISOString();
    const inWindowIso = new Date(now - 60_000).toISOString();

    recordEmailAudit({
      timestamp: oldIso,
      category: 'executive-report',
      source: 'test',
      to: ['old@example.com'],
      subject: 'Out of window email',
      transport: 'graph',
      status: 'sent',
    });

    recordEmailAudit({
      timestamp: inWindowIso,
      category: 'executive-report',
      source: 'send_manager_report_email',
      to: ['mgr@example.com'],
      subject: 'Executive Multi-Cloud Report',
      transport: 'graph',
      status: 'sent',
      attachments: ['AWS.pdf', 'GCP.pdf'],
    });

    recordEmailAudit({
      timestamp: inWindowIso,
      category: 'account-request',
      source: 'routes/requests',
      to: ['approver@example.com'],
      subject: 'AWS Account Provisioning Request',
      transport: 'graph',
      status: 'sent',
    });

    recordEmailAudit({
      timestamp: inWindowIso,
      category: 'ops-log-digest',
      source: 'send_daily_log_digest',
      to: ['ops@example.com'],
      subject: 'Previous digest',
      transport: 'graph',
      status: 'sent',
    });

    const windowData = readAuditWindow(now - 3_600_000, now + 60_000);
    assert.strictEqual(windowData.runs.length, 1, 'Window should contain 1 pipeline run');
    assert.strictEqual(windowData.emails.length, 3, 'Window should exclude 3-day-old email');

    // 3. Test buildDailyLogDigest classifications & attachment trimming
    const baseWindowStart = new Date(now - 24 * 3_600_000);
    const baseWindowEnd = new Date(now);
    const healthyRuns: PipelineRunRecord[] = EXPECTED_DAILY_JOBS.map((jobName, idx) => ({
      runId: `run-${idx}`,
      jobName,
      startedAt: inWindowIso,
      endedAt: inWindowIso,
      durationMs: 1200,
      status: 'PASS',
      exitCode: 0,
      logFile: finishedRun.logFile,
      logBytes: finishedRun.logBytes,
      lineCount: 10,
      errorCount: 0,
      warnCount: 0,
      errorHighlights: [],
    }));

    const healthyDigest = buildDailyLogDigest({
      runs: healthyRuns,
      emails: windowData.emails,
      windowStart: baseWindowStart,
      windowEnd: baseWindowEnd,
      auditDir: tmpDir,
      attachLogs: true,
    });
    assert.strictEqual(healthyDigest.healthStatus, 'ALL HEALTHY');
    assert.strictEqual(healthyDigest.summary.appEmailsTotal, 2, 'ops-log-digest must be excluded from app email counts');
    assert.strictEqual(healthyDigest.summary.appEmailsSent, 2);
    assert.strictEqual(healthyDigest.attachments.length, 3);

    const warnRuns = healthyRuns.map((r, idx) => (idx === 0 ? { ...r, warnCount: 2 } : r));
    const warnDigest = buildDailyLogDigest({
      runs: warnRuns,
      emails: windowData.emails,
      windowStart: baseWindowStart,
      windowEnd: baseWindowEnd,
      auditDir: tmpDir,
      attachLogs: false,
    });
    assert.strictEqual(warnDigest.healthStatus, 'WARNINGS');

    // Action required: (a) missing expected job
    const missingJobDigest = buildDailyLogDigest({
      runs: healthyRuns.slice(0, 2),
      emails: windowData.emails,
      windowStart: baseWindowStart,
      windowEnd: baseWindowEnd,
      auditDir: tmpDir,
      attachLogs: false,
    });
    assert.strictEqual(missingJobDigest.healthStatus, 'ACTION REQUIRED');
    assert.strictEqual(missingJobDigest.summary.missingJobs.length, 1);

    // Action required: (b) failed pipeline run
    const failedRunDigest = buildDailyLogDigest({
      runs: healthyRuns.map((r, idx) => (idx === 1 ? { ...r, status: 'FAIL', exitCode: 1 } : r)),
      emails: windowData.emails,
      windowStart: baseWindowStart,
      windowEnd: baseWindowEnd,
      auditDir: tmpDir,
      attachLogs: false,
    });
    assert.strictEqual(failedRunDigest.healthStatus, 'ACTION REQUIRED');

    // Action required: (c) failed email
    const failedEmail: EmailAuditRecord = {
      id: 'mail-fail',
      timestamp: inWindowIso,
      category: 'budget-threshold',
      source: 'accountBudgetService',
      to: ['owner@example.com'],
      subject: 'Budget 100% alert',
      transport: 'preview',
      status: 'failed',
      error: 'SMTP timeout',
    };
    const failedEmailDigest = buildDailyLogDigest({
      runs: healthyRuns,
      emails: [...windowData.emails, failedEmail],
      windowStart: baseWindowStart,
      windowEnd: baseWindowEnd,
      auditDir: tmpDir,
      attachLogs: false,
    });
    assert.strictEqual(failedEmailDigest.healthStatus, 'ACTION REQUIRED');
    assert.strictEqual(failedEmailDigest.summary.appEmailsFailed, 1);

    // Oversized raw log trimming
    const bigLines = Array.from({ length: 2000 }, (_, i) => `LINE_${String(i).padStart(4, '0')}: sample billing pipeline log payload`).join('\n');
    const trimmed = trimLogForAttachment(bigLines, 8192, '/srv/logs/audit/raw/big.log');
    assert.strictEqual(trimmed.trimmed, true);
    assert.ok(Buffer.byteLength(trimmed.content, 'utf8') <= 8192, 'Trimmed log must fit within maxBytes');
    assert.ok(trimmed.content.includes('LINE_0000'), 'Trimmed log must preserve head');
    assert.ok(trimmed.content.includes('LOG TRIMMED TO FIT EMAIL ATTACHMENT LIMIT'), 'Trimmed log must include omission marker');
    assert.ok(trimmed.content.includes('LINE_1999'), 'Trimmed log must preserve tail');

    // 4. Test pruneOldAuditFiles(14)
    const oldFile = path.join(tmpDir, 'raw', 'expired-test.log');
    const recentFile = path.join(tmpDir, 'raw', 'recent-test.log');
    fs.writeFileSync(oldFile, 'old', 'utf8');
    fs.writeFileSync(recentFile, 'recent', 'utf8');
    const twentyDaysAgo = new Date(Date.now() - 20 * 86_400_000);
    fs.utimesSync(oldFile, twentyDaysAgo, twentyDaysAgo);

    const pruneRes = pruneOldAuditFiles(14);
    assert.ok(pruneRes.deletedCount >= 1, 'Expected expired file to be pruned');
    assert.strictEqual(fs.existsSync(oldFile), false, 'Expired file should be deleted');
    assert.strictEqual(fs.existsSync(recentFile), true, 'Recent file should be kept');

    console.log('✓ All logging & email audit self-check assertions passed.');
  } finally {
    if (prevAuditDir === undefined) {
      delete process.env.AUDIT_LOG_DIR;
    } else {
      process.env.AUDIT_LOG_DIR = prevAuditDir;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ Logging self-check failed:', err);
  process.exit(1);
});
