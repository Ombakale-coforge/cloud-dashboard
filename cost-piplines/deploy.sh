#!/usr/bin/env bash
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$APP_DIR"

INIT_CRONS=false
for arg in "$@"; do
  case "$arg" in
    --init-crons) INIT_CRONS=true ;;
    *)
      echo "Usage: ./deploy.sh [--init-crons]"
      exit 1
      ;;
  esac
done

read_env_val() {
  local key="$1"
  local raw
  raw="$(grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- || true)"
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

mkdir -p logs

echo "=== 2. Installing root dependencies ==="
npm ci

echo "=== 3. Generating Prisma 7 client & applying SQL Server migrations ==="
npx prisma generate --config prisma7.config.ts
npx prisma migrate deploy --config prisma7.config.ts

echo "=== 4. Installing & building frontend (cost-dashboard/dist) ==="
npm ci --prefix cost-dashboard
npm run build --prefix cost-dashboard

echo "=== 5. Reloading web server via PM2 ==="
pm2 startOrReload ecosystem.config.cjs --only cost-dashboard --update-env

if [ "$INIT_CRONS" = true ]; then
  echo "=== 5b. Registering PM2 cron jobs (--init-crons) ==="
  pm2 start ecosystem.config.cjs --only daily-data-refresh,daily-cost-report-email,azure-daily-cost-burst-alerts --update-env
fi

pm2 save

echo "=== 6. Health check ==="
PORT_VAL="${PORT:-$(read_env_val PORT)}"
PORT_VAL="${PORT_VAL:-3001}"
sleep 2
curl -fsS "http://127.0.0.1:${PORT_VAL}/api/health" && echo ""
echo "=== Deploy complete ==="
