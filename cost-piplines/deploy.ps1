param(
  [switch]$InitCrons,
  [switch]$CleanPm2,
  [switch]$SkipChecks
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

function Invoke-Native {
  param(
    [string]$File,
    [string[]]$Arguments
  )
  & $File @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Command failed (exit $LASTEXITCODE): $File $($Arguments -join ' ')"
  }
}

function Read-EnvVal {
  param(
    [string]$Key,
    [string]$File = ".env"
  )
  if (-not (Test-Path $File)) {
    return ""
  }
  $pattern = "^$([regex]::Escape($Key))="
  $matches = Get-Content -Path $File -ErrorAction SilentlyContinue | Where-Object { $_ -match $pattern }
  if (-not $matches) {
    return ""
  }
  $lastLine = @($matches)[-1]
  $idx = $lastLine.IndexOf("=")
  if ($idx -lt 0) {
    return ""
  }
  $raw = $lastLine.Substring($idx + 1).Trim()
  if ($raw.Length -ge 2) {
    if (($raw.StartsWith('"') -and $raw.EndsWith('"')) -or ($raw.StartsWith("'") -and $raw.EndsWith("'"))) {
      $raw = $raw.Substring(1, $raw.Length - 2)
    }
  }
  return $raw
}

Write-Host "=== 1. Preflight checks ==="
if (-not (Test-Path ".env")) {
  Write-Error "ERROR: .env missing in $PSScriptRoot (copy from .env.example)"
  exit 1
}

$JwtVal = Read-EnvVal -Key "JWT_SECRET"
if ($JwtVal.Length -lt 32) {
  Write-Host "ERROR: JWT_SECRET must be set (min 32 chars) in .env for production." -ForegroundColor Red
  Write-Host 'Generate one with: node -e "console.log(require(''crypto'').randomBytes(48).toString(''hex''))"'
  exit 1
}

$DbVal = Read-EnvVal -Key "DATABASE_URL"
if ([string]::IsNullOrWhiteSpace($DbVal)) {
  Write-Host "ERROR: DATABASE_URL is missing in .env." -ForegroundColor Red
  exit 1
}

$DigestTo = Read-EnvVal -Key "LOG_DIGEST_EMAIL_TO"
$AdminMail = Read-EnvVal -Key "ADMIN_EMAIL"
if ([string]::IsNullOrWhiteSpace($DigestTo) -and [string]::IsNullOrWhiteSpace($AdminMail)) {
  Write-Warning "Neither LOG_DIGEST_EMAIL_TO nor ADMIN_EMAIL is set in .env; daily-ops-log-digest will fail without a recipient."
}

$CookieSec = Read-EnvVal -Key "COOKIE_SECURE"
$SslPfx = Read-EnvVal -Key "SSL_PFX_PATH"
if ($CookieSec -eq "true" -and [string]::IsNullOrWhiteSpace($SslPfx)) {
  Write-Warning "COOKIE_SECURE=true without SSL_PFX_PATH -- ensure TLS + 'X-Forwarded-Proto: https' are configured, or plain HTTP will drop cd_session cookies (401 on /api/budgets/my-accounts)."
}

$RootRate = Read-EnvVal -Key "AZURE_USD_TO_INR_RATE" -File ".env"
$FeRate = Read-EnvVal -Key "VITE_AZURE_USD_TO_INR_RATE" -File "cost-dashboard/.env"
if (-not [string]::IsNullOrWhiteSpace($RootRate) -and -not [string]::IsNullOrWhiteSpace($FeRate) -and ($RootRate -ne $FeRate)) {
  Write-Warning "cost-dashboard/.env VITE_AZURE_USD_TO_INR_RATE ($FeRate) differs from .env AZURE_USD_TO_INR_RATE ($RootRate); UI and email/PDF USD values may differ."
}

if (Get-Command Get-ScheduledTask -ErrorAction SilentlyContinue) {
  $legacyTasks = @(Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object {
    $_.State -ne "Disabled" -and (
      $_.TaskName -match 'cost|refresh|finops|dashboard|azure' -or
      ($_.Actions | Where-Object { $_.Arguments -match 'refresh-data\.ps1' })
    )
  })
  if ($legacyTasks.Count -gt 0) {
    $names = ($legacyTasks | ForEach-Object { $_.TaskName }) -join ", "
    Write-Warning "Enabled Windows Scheduled Task(s) detected ($names). Disable any legacy refresh-data.ps1 task so it does not overlap with PM2 daily-data-refresh."
  }
}

New-Item -ItemType Directory -Force -Path "logs", "logs\audit\raw" | Out-Null

Write-Host "=== 2. Installing root dependencies ==="
Invoke-Native "npm" @("ci")

Write-Host "=== 3. Generating Prisma 7 client & applying SQL Server migrations ==="
Invoke-Native "npx" @("prisma", "generate", "--config", "prisma7.config.ts")
& npx prisma migrate deploy --config prisma7.config.ts
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERROR: prisma migrate deploy failed." -ForegroundColor Red
  Write-Host "If dbo.cloud_account_budgets already existed before Prisma tracked 20261117094503_manual_budget_tables (P3009), baseline it once:"
  Write-Host "  npx prisma migrate resolve --applied 20261117094503_manual_budget_tables --config prisma7.config.ts"
  Write-Host "Then re-run .\deploy.ps1."
  exit 1
}

Write-Host "=== 4. Installing & building frontend (cost-dashboard/dist) ==="
Invoke-Native "npm" @("ci", "--prefix", "cost-dashboard")

$ViteRate = $env:VITE_AZURE_USD_TO_INR_RATE
if ([string]::IsNullOrWhiteSpace($ViteRate)) { $ViteRate = $FeRate }
if ([string]::IsNullOrWhiteSpace($ViteRate)) { $ViteRate = $env:AZURE_USD_TO_INR_RATE }
if ([string]::IsNullOrWhiteSpace($ViteRate)) { $ViteRate = $RootRate }
if ([string]::IsNullOrWhiteSpace($ViteRate)) { $ViteRate = "84" }

$prevViteRate = $env:VITE_AZURE_USD_TO_INR_RATE
try {
  $env:VITE_AZURE_USD_TO_INR_RATE = $ViteRate
  Write-Host "Building frontend with VITE_AZURE_USD_TO_INR_RATE=$ViteRate"
  Invoke-Native "npm" @("run", "build", "--prefix", "cost-dashboard")
} finally {
  if ($null -eq $prevViteRate) {
    Remove-Item Env:VITE_AZURE_USD_TO_INR_RATE -ErrorAction SilentlyContinue
  } else {
    $env:VITE_AZURE_USD_TO_INR_RATE = $prevViteRate
  }
}

if (-not $SkipChecks) {
  Write-Host "=== 4b. Running offline self-checks ==="
  Invoke-Native "npm" @("run", "test:currency")
  Invoke-Native "npm" @("run", "test:logging")
  Invoke-Native "npx" @("tsx", "src/server/services/accountOwnershipService.self-check.ts")
}

Write-Host "=== 5. Reloading web server via PM2 ==="
if ($CleanPm2) {
  Write-Host "=== 5a. Clearing existing PM2 processes (-CleanPm2) ==="
  & pm2 delete all 2>$null
  $global:LASTEXITCODE = 0
}

Invoke-Native "pm2" @("startOrReload", "ecosystem.config.cjs", "--only", "cost-dashboard", "--update-env")

$CronJobs = @(
  "daily-data-refresh",
  "daily-cost-report-email",
  "azure-daily-cost-burst-alerts",
  "daily-ops-log-digest"
)

$registeredPm2 = @()
try {
  $jlistOut = & pm2 jlist 2>$null
  if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace($jlistOut)) {
    $parsed = ($jlistOut -join "`n") | ConvertFrom-Json
    $registeredPm2 = @($parsed | ForEach-Object { $_.name } | Where-Object { $_ })
  }
} catch {
  $registeredPm2 = @()
}

$missingCrons = @($CronJobs | Where-Object { $registeredPm2 -notcontains $_ })

if ($InitCrons) {
  if ($missingCrons.Count -eq 0) {
    Write-Host "=== 5b. All PM2 cron jobs already registered (skipping to avoid re-triggering) ==="
  } else {
    Write-Host "=== 5b. Registering missing PM2 cron jobs: $($missingCrons -join ', ') ==="
    foreach ($job in $missingCrons) {
      Invoke-Native "pm2" @("start", "ecosystem.config.cjs", "--only", $job, "--update-env")
    }
  }
} elseif ($missingCrons.Count -gt 0) {
  Write-Warning "PM2 cron job(s) not yet registered: $($missingCrons -join ', ')"
  Write-Host "         Run '.\deploy.ps1 -InitCrons' to register only the missing job(s)."
}

Invoke-Native "pm2" @("save")

Write-Host "=== 6. Health check ==="
$PortVal = $env:PORT
if ([string]::IsNullOrWhiteSpace($PortVal)) { $PortVal = Read-EnvVal -Key "PORT" }
if ([string]::IsNullOrWhiteSpace($PortVal)) { $PortVal = "3001" }

$healthOk = $false
for ($i = 1; $i -le 10; $i++) {
  try {
    $resp = Invoke-RestMethod -Uri "http://127.0.0.1:$PortVal/api/health" -TimeoutSec 5
    Write-Host ($resp | ConvertTo-Json -Compress)
    $healthOk = $true
    break
  } catch {
    Start-Sleep -Seconds 1
  }
}

if (-not $healthOk) {
  Write-Host "ERROR: Health check failed on http://127.0.0.1:$PortVal/api/health" -ForegroundColor Red
  & pm2 logs cost-dashboard --lines 25 --nostream
  exit 1
}

Write-Host "=== Deploy complete ==="
