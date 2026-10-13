# refresh-data.ps1
# Automated daily data refresh script for Cost Intelligence Dashboard

param(
    [string]$LogFile = "$PSScriptRoot\logs\daily-refresh.log"
)

$ErrorActionPreference = "Continue"
$logDir = Split-Path $LogFile
if (-not (Test-Path $logDir)) { 
    New-Item -ItemType Directory -Path $logDir -Force | Out-Null 
}

function Log($msg) {
    $ts = (Get-Date).ToString("yyyy-MM-dd HH:mm:ss")
    $line = "[$ts] $msg"
    Write-Host $line
    Add-Content -Path $LogFile -Value $line
}

Log "=========================================================="
Log "Starting Daily Cost Intelligence Data Refresh"
Log "=========================================================="
Set-Location -Path $PSScriptRoot

try {
    # 1. Ingest Azure FOCUS Export records into SQL Server
    Log "[1/3] Ingesting Azure FOCUS export data..."
    npm run ingest:focus 2>&1 | Tee-Object -FilePath $LogFile -Append

    # 2. Compute 17 FinOps analytical reports & anomalies
    Log "[2/3] Calculating Azure FinOps analytics reports..."
    npm run report:azure 2>&1 | Tee-Object -FilePath $LogFile -Append

    # 3. Synchronize Azure Budgets
    Log "[3/3] Syncing Azure budgets..."
    npm run sync:azure-budgets 2>&1 | Tee-Object -FilePath $LogFile -Append

    # 4. Optional: AWS Cost Explorer data if configured
    if (Test-Path .env) {
        $envContent = Get-Content .env -Raw
        if ($envContent -match "AWS_ACCESS_KEY_ID=AKIA") {
            Log "[4/4] Refreshing AWS Cost Explorer reports..."
            npm run report:aws 2>&1 | Tee-Object -FilePath $LogFile -Append
            npm run seed:aws 2>&1 | Tee-Object -FilePath $LogFile -Append
        }
    }

    Log "=========================================================="
    Log "Daily Cost Data Refresh Completed Successfully!"
    Log "=========================================================="
} catch {
    Log "ERROR during daily refresh: $_"
}
