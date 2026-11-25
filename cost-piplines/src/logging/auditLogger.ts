import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../..');

export type EmailAuditCategory =
  | 'executive-report'
  | 'budget-threshold'
  | 'budget-instant'
  | 'azure-daily-burst'
  | 'account-request'
  | 'azure-anomaly-alert'
  | 'azure-meter-budget'
  | 'ops-log-digest'
  | 'other';

export interface EmailAuditRecord {
  id: string;
  timestamp: string;
  category: EmailAuditCategory | string;
  source: string;
  to: string[];
  cc?: string[];
  from?: string;
  subject: string;
  transport: 'graph' | 'smtp' | 'preview' | 'none';
  status: 'sent' | 'failed' | 'dry-run' | 'skipped';
  attachments?: string[];
  messageId?: string;
  error?: string;
}

export interface PipelineStepSummary {
  id?: string;
  label: string;
  status: 'PASS' | 'FAIL' | 'SKIPPED';
  durationSec: string;
  detail?: string;
}

export interface PipelineRunRecord {
  runId: string;
  jobName: string;
  command?: string;
  startedAt: string;
  endedAt: string;
  durationMs: number;
  status: 'PASS' | 'FAIL';
  exitCode: number;
  dryRun?: boolean;
  logFile: string;
  logBytes: number;
  lineCount: number;
  errorCount: number;
  warnCount: number;
  errorHighlights: string[];
  steps?: PipelineStepSummary[];
  summaryNote?: string;
}

export interface PipelineRunFinishOptions {
  exitCode: number;
  steps?: PipelineStepSummary[];
  summaryNote?: string;
  dryRun?: boolean;
}

export interface PipelineRunCapture {
  runId: string;
  logPath: string;
  finish: (opts: PipelineRunFinishOptions) => PipelineRunRecord | null;
}

const MAX_HIGHLIGHTS = 15;
const MAX_HIGHLIGHT_LEN = 300;
const ERROR_LINE_RE = /❌|\bERROR\b|\bFatal\b|Failed:/i;
const WARN_LINE_RE = /⚠️|\bWARN\b|\bWARNING\b/i;

export function getAuditDir(): string {
  return process.env.AUDIT_LOG_DIR
    ? path.resolve(process.env.AUDIT_LOG_DIR)
    : path.resolve(ROOT_DIR, 'logs', 'audit');
}

export function isAuditDisabled(): boolean {
  const val = process.env.AUDIT_LOG_DISABLE;
  return val === '1' || val === 'true';
}

export function stripAnsi(str: string): string {
  return str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');
}

function ensureDirSafe(dir: string): boolean {
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return true;
  } catch {
    return false;
  }
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append one structured email audit record to logs/audit/emails-YYYY-MM-DD.jsonl.
 * Fail-safe: never throws so outbound email flows are never disrupted by logging issues.
 */
export function recordEmailAudit(
  entry: Omit<EmailAuditRecord, 'id' | 'timestamp'> & { id?: string; timestamp?: string }
): void {
  if (isAuditDisabled()) return;

  try {
    const auditDir = getAuditDir();
    if (!ensureDirSafe(auditDir)) return;

    const timestamp = entry.timestamp || new Date().toISOString();
    const record: EmailAuditRecord = {
      ...entry,
      id: entry.id || makeId('mail'),
      timestamp,
      to: Array.isArray(entry.to) ? entry.to.filter(Boolean) : [],
      ...(entry.cc && entry.cc.length > 0 ? { cc: entry.cc.filter(Boolean) } : {}),
      ...(entry.attachments && entry.attachments.length > 0
        ? { attachments: entry.attachments.filter(Boolean) }
        : {}),
    };

    const dateKey = timestamp.slice(0, 10);
    const filePath = path.join(auditDir, `emails-${dateKey}.jsonl`);
    // ponytail: single-host POSIX appendFileSync is atomic for <4KB lines; switch to SQL/log-shipper if scaling to multiple hosts.
    fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, 'utf8');
  } catch {
    // Fail-safe: ignore logging errors
  }
}

/**
 * Synchronously tee stdout/stderr to a raw run log file while preserving live console/PM2 streaming.
 * Uses synchronous fd writes so no tail lines are lost when scripts call process.exit().
 */
export function startPipelineRunCapture(
  jobName: string,
  options?: { command?: string; enabled?: boolean }
): PipelineRunCapture {
  if (options?.enabled === false || isAuditDisabled()) {
    return { runId: '', logPath: '', finish: () => null };
  }

  const startedAtDate = new Date();
  const startedAt = startedAtDate.toISOString();
  const datePart = startedAt.slice(0, 10);
  const timePart = startedAt.slice(11, 19).replace(/:/g, '-');
  const safeJob = jobName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const runId = `${datePart}_${safeJob}_${timePart}_${process.pid}`;

  const auditDir = getAuditDir();
  const rawDir = path.join(auditDir, 'raw');
  if (!ensureDirSafe(rawDir)) {
    return { runId: '', logPath: '', finish: () => null };
  }

  const relLogFile = path.join('raw', `${runId}.log`);
  const logPath = path.join(auditDir, relLogFile);

  let fd: number | null = null;
  try {
    fd = fs.openSync(logPath, 'a');
  } catch {
    return { runId: '', logPath: '', finish: () => null };
  }

  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  const origStderrWrite = process.stderr.write.bind(process.stderr);

  let lineCount = 0;
  let errorCount = 0;
  let warnCount = 0;
  const errorHighlights: string[] = [];
  let stdoutPartial = '';
  let stderrPartial = '';
  let finished = false;

  const inspectLine = (rawLine: string, isStderr: boolean): void => {
    const trimmed = rawLine.trim();
    if (!trimmed) return;
    lineCount++;

    const isErr = isStderr || ERROR_LINE_RE.test(trimmed);
    const isWarn = !isErr && WARN_LINE_RE.test(trimmed);

    if (isErr) {
      errorCount++;
    } else if (isWarn) {
      warnCount++;
    }

    if ((isErr || isWarn) && errorHighlights.length < MAX_HIGHLIGHTS) {
      const prefix = isStderr && !ERROR_LINE_RE.test(trimmed) ? '[stderr] ' : '';
      const snippet = `${prefix}${trimmed}`.slice(0, MAX_HIGHLIGHT_LEN);
      errorHighlights.push(snippet);
    }
  };

  const captureChunk = (
    chunk: Uint8Array | string,
    encodingOrCb: BufferEncoding | ((err?: Error | null) => void) | undefined,
    isStderr: boolean
  ): void => {
    if (fd === null) return;
    try {
      const encoding = typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8';
      const rawText = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString(encoding);
      const clean = stripAnsi(rawText);
      fs.writeSync(fd, clean, null, 'utf8');

      const combined = (isStderr ? stderrPartial : stdoutPartial) + clean;
      const lines = combined.split(/\r?\n/);
      const tail = lines.pop() ?? '';
      if (isStderr) {
        stderrPartial = tail;
      } else {
        stdoutPartial = tail;
      }

      for (const line of lines) {
        inspectLine(line, isStderr);
      }
    } catch {
      // Never throw from stream tee
    }
  };

  process.stdout.write = ((
    chunk: Uint8Array | string,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void
  ): boolean => {
    captureChunk(chunk, encodingOrCb, false);
    if (typeof encodingOrCb === 'function') {
      return origStdoutWrite(chunk, encodingOrCb);
    }
    return origStdoutWrite(chunk, encodingOrCb, cb);
  }) as typeof process.stdout.write;

  process.stderr.write = ((
    chunk: Uint8Array | string,
    encodingOrCb?: BufferEncoding | ((err?: Error | null) => void),
    cb?: (err?: Error | null) => void
  ): boolean => {
    captureChunk(chunk, encodingOrCb, true);
    if (typeof encodingOrCb === 'function') {
      return origStderrWrite(chunk, encodingOrCb);
    }
    return origStderrWrite(chunk, encodingOrCb, cb);
  }) as typeof process.stderr.write;

  return {
    runId,
    logPath,
    finish(finishOpts: PipelineRunFinishOptions): PipelineRunRecord | null {
      if (finished) return null;
      finished = true;

      try {
        process.stdout.write = origStdoutWrite as typeof process.stdout.write;
        process.stderr.write = origStderrWrite as typeof process.stderr.write;

        if (stdoutPartial) {
          inspectLine(stdoutPartial, false);
          stdoutPartial = '';
        }
        if (stderrPartial) {
          inspectLine(stderrPartial, true);
          stderrPartial = '';
        }

        if (fd !== null) {
          try {
            fs.closeSync(fd);
          } catch {
            // ignore
          }
          fd = null;
        }

        const endedAtDate = new Date();
        const endedAt = endedAtDate.toISOString();
        const durationMs = Math.max(0, endedAtDate.getTime() - startedAtDate.getTime());

        let logBytes = 0;
        try {
          logBytes = fs.statSync(logPath).size;
        } catch {
          logBytes = 0;
        }

        const record: PipelineRunRecord = {
          runId,
          jobName,
          ...(options?.command ? { command: options.command } : {}),
          startedAt,
          endedAt,
          durationMs,
          status: finishOpts.exitCode === 0 ? 'PASS' : 'FAIL',
          exitCode: finishOpts.exitCode,
          ...(finishOpts.dryRun ? { dryRun: true } : {}),
          logFile: relLogFile,
          logBytes,
          lineCount,
          errorCount,
          warnCount,
          errorHighlights,
          ...(finishOpts.steps && finishOpts.steps.length > 0 ? { steps: finishOpts.steps } : {}),
          ...(finishOpts.summaryNote ? { summaryNote: finishOpts.summaryNote } : {}),
        };

        const runsFile = path.join(auditDir, `runs-${datePart}.jsonl`);
        fs.appendFileSync(runsFile, `${JSON.stringify(record)}\n`, 'utf8');
        return record;
      } catch {
        return null;
      }
    },
  };
}

/**
 * Spawn a child process while piping stdout/stderr through the current process streams
 * so both PM2 logs and any active startPipelineRunCapture() tee receive all child output.
 */
export function runChildWithCapture(
  command: string,
  args: string[],
  opts?: { cwd?: string; env?: NodeJS.ProcessEnv; shell?: boolean }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts?.cwd,
      env: opts?.env ?? process.env,
      shell: opts?.shell ?? false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stderrTail = '';

    child.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk);
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk);
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-1000);
    });

    child.on('error', (err) => {
      reject(err);
    });

    child.on('close', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      const reason = code !== null ? `exit code ${code}` : `signal ${signal ?? 'unknown'}`;
      const tailMsg = stderrTail.trim() ? `: ${stderrTail.trim().split(/\r?\n/).slice(-3).join(' | ')}` : '';
      reject(new Error(`Command "${command} ${args.join(' ')}" failed with ${reason}${tailMsg}`));
    });
  });
}

function readJsonlFile<T>(filePath: string): T[] {
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    const items: T[] = [];
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        items.push(JSON.parse(trimmed) as T);
      } catch {
        // Skip malformed line defensively
      }
    }
    return items;
  } catch {
    return [];
  }
}

/**
 * Read pipeline runs and email audit records within [startMs, endMs].
 * Scans UTC calendar date files from (startMs - 1d) through (endMs + 1d) to handle timezone boundaries safely.
 */
export function readAuditWindow(
  startMs: number,
  endMs: number
): { runs: PipelineRunRecord[]; emails: EmailAuditRecord[] } {
  const auditDir = getAuditDir();
  if (!fs.existsSync(auditDir)) {
    return { runs: [], emails: [] };
  }

  const dayKeys: string[] = [];
  const cursor = new Date(startMs - 86_400_000);
  const limit = endMs + 86_400_000;
  cursor.setUTCHours(0, 0, 0, 0);

  while (cursor.getTime() <= limit) {
    dayKeys.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const runs: PipelineRunRecord[] = [];
  const emails: EmailAuditRecord[] = [];

  for (const key of dayKeys) {
    for (const r of readJsonlFile<PipelineRunRecord>(path.join(auditDir, `runs-${key}.jsonl`))) {
      const t = Date.parse(r.startedAt);
      if (Number.isFinite(t) && t >= startMs && t <= endMs) {
        runs.push(r);
      }
    }
    for (const e of readJsonlFile<EmailAuditRecord>(path.join(auditDir, `emails-${key}.jsonl`))) {
      const t = Date.parse(e.timestamp);
      if (Number.isFinite(t) && t >= startMs && t <= endMs) {
        emails.push(e);
      }
    }
  }

  runs.sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
  emails.sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp));

  return { runs, emails };
}

/**
 * Delete audit JSONL files and raw pipeline logs older than `retentionDays`.
 */
export function pruneOldAuditFiles(retentionDays = 14): { deletedCount: number } {
  if (isAuditDisabled()) return { deletedCount: 0 };
  const days = Number.isFinite(retentionDays) && retentionDays > 0 ? retentionDays : 14;
  const cutoffMs = Date.now() - days * 86_400_000;
  const auditDir = getAuditDir();
  let deletedCount = 0;

  for (const dir of [auditDir, path.join(auditDir, 'raw')]) {
    if (!fs.existsSync(dir)) continue;
    try {
      for (const entry of fs.readdirSync(dir)) {
        const fullPath = path.join(dir, entry);
        try {
          const stat = fs.statSync(fullPath);
          if (stat.isFile() && stat.mtimeMs < cutoffMs) {
            fs.unlinkSync(fullPath);
            deletedCount++;
          }
        } catch {
          // ignore per-file errors
        }
      }
    } catch {
      // ignore directory errors
    }
  }

  return { deletedCount };
}
