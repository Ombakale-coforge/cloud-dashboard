# Deployment Runbook (`cost-piplines`)

> Git repository root is the parent directory (`cloud-dashboard/`), not `cost-piplines/`.

## 1. Windows Server — Clean From-Scratch Deploy (Option B: Existing Folder)

```powershell
cd C:\Users\<user>\Desktop\cloud-dashboard
git pull origin main
cd cost-piplines

# 1. Verify required .env keys (update LOG_DIGEST_EMAIL_TO, AZURE_USD_TO_INR_RATE, etc.)
Select-String -Path .env -Pattern '^(LOG_DIGEST_EMAIL_TO|LOG_RETENTION_DAYS|AZURE_USD_TO_INR_RATE|COOKIE_SECURE|SSL_PFX_PATH|PORT)='

# 2. Check & disable any legacy Task Scheduler job running refresh-data.ps1
Get-ScheduledTask | Where-Object { $_.TaskName -match 'cost|refresh|finops|dashboard|azure' } | Format-Table TaskName, State

# 3. Clean PM2 reset + full install, migrate, build, offline checks, and register all 4 crons
.\deploy.ps1 -CleanPm2 -InitCrons
```

> [!WARNING]
> `-CleanPm2` deletes all PM2 processes and re-registers every cron. Because `pm2 start` executes each newly registered cron once immediately, running `-CleanPm2 -InitCrons` mid-day will trigger `daily-cost-report-email`, `azure-daily-cost-burst-alerts`, `daily-data-refresh`, and `daily-ops-log-digest` right away. Omit `-CleanPm2` if you want to preserve already-registered crons.

## 2. Windows Server — Routine Update Deploy

```powershell
cd C:\Users\<user>\Desktop\cloud-dashboard
git pull origin main
cd cost-piplines
.\deploy.ps1 -InitCrons
```

- `-InitCrons` inspects `pm2 jlist` and **only starts unregistered crons** — existing crons are never re-triggered.
- Pass `-SkipChecks` only for emergency hotfixes if you need to skip offline self-checks.

## 3. Linux / Bash Deploy

```bash
cd /path/to/cloud-dashboard && git pull origin main && cd cost-piplines
./deploy.sh --init-crons
```

## 4. Post-Deploy Verification Checklist

1. **Web & API**: `pm2 list` (all 5 apps listed, `cost-dashboard` online) and `Invoke-RestMethod http://127.0.0.1:3001/api/health`.
2. **Session Cookies & My Accounts**: Existing users must **sign out and sign back in once** to receive the `cd_session` httpOnly cookie; verify `/newrequest` → **My Accounts & Budgets** loads owned Azure/AWS accounts.
3. **MS Graph Permissions**: Check `pm2 logs cost-dashboard --lines 40 --nostream` for `[AzureOwnership] MS Graph getByIds HTTP 403` (requires `Directory.Read.All` application permission with admin consent; otherwise ownership falls back to subscription/RG tags).
4. **Azure USD Display**: Confirm Azure UI pages show USD matching `AZURE_USD_TO_INR_RATE`.
5. **Log Digest**: Run `npm run logs:digest:preview` and check `pm2 logs daily-ops-log-digest --lines 25 --nostream`.
6. **Optional Auto-Budget Seeding** (`927f0fd`): Trigger `POST /api/budgets/seed-default-budgets` if you want unbudgeted accounts seeded at `last month spend + 5%`.

## 5. Common Mistakes & Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `prisma migrate deploy` fails with `P3009` on `20261117094503_manual_budget_tables` | `dbo.cloud_account_budgets` was already created at runtime by `db-alert-tables.ts` | Run once: `npx prisma migrate resolve --applied 20261117094503_manual_budget_tables --config prisma7.config.ts`, then re-run `.\deploy.ps1 -InitCrons`. |
| `401 UNAUTHENTICATED` on `/api/budgets/my-accounts` over HTTP | `COOKIE_SECURE=true` set in `.env` on plain HTTP | Remove `COOKIE_SECURE=true` on HTTP, or terminate TLS and forward `X-Forwarded-Proto: https`. |
| UI USD values don't match emails/PDFs | `cost-dashboard/.env` overrides `VITE_AZURE_USD_TO_INR_RATE` with a stale value | Remove/align `VITE_AZURE_USD_TO_INR_RATE` in `cost-dashboard/.env` and rebuild via `.\deploy.ps1`. |
| Legacy `refresh-data.ps1` overlaps with `daily-data-refresh` | Old Windows Scheduled Task still enabled | Run `Disable-ScheduledTask -TaskName "<TaskName>"`. |
| `pm2 start ecosystem.config.cjs` fires daily report/burst emails mid-day | Running `pm2 start` directly against already-registered crons | Always use `.\deploy.ps1 -InitCrons` (only starts missing crons) without `-CleanPm2`. |
| `JWT_SECRET` / `PORT` parse errors from `.env` | Windows CRLF (`\r\n`) line endings in `.env` | Both `deploy.ps1` and `deploy.sh` strip `\r`/whitespace automatically. |
