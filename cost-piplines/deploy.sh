#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

INIT_CRONS=false
SKIP_CHECKS=false
for arg in "$@"; do
  case "$arg" in
    --init-crons) INIT_CRONS=true ;;
    --skip-checks) SKIP_CHECKS=true ;;
    *)
      echo "Usage: ./deploy.sh [--init-crons] [--skip-checks]"
      exit 1
      ;;
  esac
done

read_env_val() {
  local key="$1"
  local file="${2:-.env}"
  local raw
  [ -f "$file" ] || return 0
  raw="$(grep -E "^${key}=" "$file" | tail -n1 | cut -d= -f2- || true)"
  raw="${raw%$'\r'}"
  raw="${raw%\"}"
  raw="${raw#\"}"
  raw="${raw%\'}"
  raw="${raw#\'}"
  printf '%s' "$raw"
}

echo "=== 1. Preflight checks ==="
test -f .env || { echo "ERROR: .env missing in $APP_DIR (copy from .env.example)"; exit 1; }

JWT_VAL="$(read_env_val JWT_SECRET)"
if [ "${#JWT_VAL}" -lt 32 ]; then
  echo "ERROR: JWT_SECRET must be set (min 32 chars) in .env for production."
  echo "Generate one with: node -e \"console.log(require('crypto').randomBytes(48).toString('hex'))\""
  exit 1
fi

DB_VAL="$(read_env_val DATABASE_URL)"
if [ -z "$DB_VAL" ]; then
  echo "ERROR: DATABASE_URL is missing in .env."
  exit 1
fi

DIGEST_TO="$(read_env_val LOG_DIGEST_EMAIL_TO .env)"
ADMIN_MAIL="$(read_env_val ADMIN_EMAIL .env)"
if [ -z "$DIGEST_TO" ] && [ -z "$ADMIN_MAIL" ]; then
  echo "WARNING: Neither LOG_DIGEST_EMAIL_TO nor ADMIN_EMAIL is set in .env; daily-ops-log-digest will fail without a recipient."
fi

COOKIE_SEC="$(read_env_val COOKIE_SECURE .env)"
SSL_PFX="$(read_env_val SSL_PFX_PATH .env)"
if [ "$COOKIE_SEC" = "true" ] && [ -z "$SSL_PFX" ]; then
  echo "WARNING: COOKIE_SECURE=true without SSL_PFX_PATH — ensure TLS + 'X-Forwarded-Proto: https' are set, or plain HTTP will drop cd_session cookies (401 on /api/budgets/my-accounts)."
fi

ROOT_RATE="$(read_env_val AZURE_USD_TO_INR_RATE .env)"
FE_RATE="$(read_env_val VITE_AZURE_USD_TO_INR_RATE cost-dashboard/.env)"
if [ -n "$ROOT_RATE" ] && [ -n "$FE_RATE" ] && [ "$ROOT_RATE" != "$FE_RATE" ]; then
  echo "WARNING: cost-dashboard/.env VITE_AZURE_USD_TO_INR_RATE ($FE_RATE) differs from .env AZURE_USD_TO_INR_RATE ($ROOT_RATE); UI and email/PDF USD values may differ."
fi

mkdir -p logs logs/audit/raw

echo "=== 2. Installing root dependencies ==="
npm ci

echo "=== 3. Generating Prisma 7 client & applying SQL Server migrations ==="
npx prisma generate --config prisma7.config.ts
if ! npx prisma migrate deploy --config prisma7.config.ts; then
  echo "ERROR: prisma migrate deploy failed."
  echo "If dbo.cloud_account_budgets already existed before Prisma tracked 20261117094503_manual_budget_tables (P3009), baseline it once:"
  echo "  npx prisma migrate resolve --applied 20261117094503_manual_budget_tables --config prisma7.config.ts"
  echo "Then re-run ./deploy.sh."
  exit 1
fi

echo "=== 4. Installing & building frontend (cost-dashboard/dist) ==="
npm ci --prefix cost-dashboard
VITE_RATE="${VITE_AZURE_USD_TO_INR_RATE:-$FE_RATE}"
if [ -z "$VITE_RATE" ]; then
  VITE_RATE="${AZURE_USD_TO_INR_RATE:-$ROOT_RATE}"
fi
VITE_RATE="${VITE_RATE:-84}"
echo "Building frontend with VITE_AZURE_USD_TO_INR_RATE=${VITE_RATE}"
VITE_AZURE_USD_TO_INR_RATE="$VITE_RATE" npm run build --prefix cost-dashboard

if [ "$SKIP_CHECKS" != true ]; then
  echo "=== 4b. Running offline self-checks ==="
  npm run test:currency
  npm run test:logging
  npx tsx src/server/services/accountOwnershipService.self-check.ts
fi

echo "=== 5. Reloading web server via PM2 ==="
pm2 startOrReload ecosystem.config.cjs --only cost-dashboard --update-env

CRON_JOBS=(
  daily-data-refresh
  daily-cost-report-email
  azure-daily-cost-burst-alerts
  daily-ops-log-digest
)
REGISTERED_PM2="$(pm2 jlist 2>/dev/null | node -e "const raw = require('fs').readFileSync(0,'utf8').trim(); const list = raw ? JSON.parse(raw) : []; console.log(list.map((p) => p.name).join('\n'));" || true)"
MISSING_CRONS=()
for job in "${CRON_JOBS[@]}"; do
  if ! printf '%s\n' "$REGISTERED_PM2" | grep -Fxq "$job"; then
    MISSING_CRONS+=("$job")
  fi
done

if [ "$INIT_CRONS" = true ]; then
  if [ "${#MISSING_CRONS[@]}" -eq 0 ]; then
    echo "=== 5b. All PM2 cron jobs already registered (skipping to avoid re-triggering) ==="
  else
    echo "=== 5b. Registering missing PM2 cron jobs: ${MISSING_CRONS[*]} ==="
    for job in "${MISSING_CRONS[@]}"; do
      pm2 start ecosystem.config.cjs --only "$job" --update-env
    done
  fi
elif [ "${#MISSING_CRONS[@]}" -gt 0 ]; then
  echo "WARNING: PM2 cron job(s) not yet registered: ${MISSING_CRONS[*]}"
  echo "         Run './deploy.sh --init-crons' to register only the missing job(s)."
fi

pm2 save

echo "=== 6. Health check ==="
PORT_VAL="${PORT:-$(read_env_val PORT)}"
PORT_VAL="${PORT_VAL:-3001}"
HEALTH_OK=false
for _ in $(seq 1 10); do
  if curl -fsS "http://127.0.0.1:${PORT_VAL}/api/health"; then
    echo ""
    HEALTH_OK=true
    break
  fi
  sleep 1
done
if [ "$HEALTH_OK" != true ]; then
  echo "ERROR: Health check failed on http://127.0.0.1:${PORT_VAL}/api/health"
  pm2 logs cost-dashboard --lines 25 --nostream || true
  exit 1
fi
echo "=== Deploy complete ==="
