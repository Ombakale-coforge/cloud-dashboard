import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const dashboardRoot = path.resolve(__dirname, "..");
const projectRoot = path.resolve(dashboardRoot, "..");
const awsLatestDir = path.join(projectRoot, "AWSReports", "latest");
const awsAccountsDir = path.join(projectRoot, "AWSReports", "accounts");
const publicDataDir = path.join(dashboardRoot, "public", "data");

function copyDirFiles(srcDir: string, destDir: string): number {
  if (!fs.existsSync(srcDir)) return 0;
  fs.mkdirSync(destDir, { recursive: true });
  let count = 0;
  for (const file of fs.readdirSync(srcDir)) {
    const srcPath = path.join(srcDir, file);
    if (fs.statSync(srcPath).isFile() && (file.endsWith(".csv") || file.endsWith(".json"))) {
      fs.copyFileSync(srcPath, path.join(destDir, file));
      count++;
    }
  }
  return count;
}

export function sync(): void {
  console.log("🔄 Syncing AWS report files to cost-dashboard/public/data...");

  // 1. Copy latest AWS root reports
  const latestCount = copyDirFiles(awsLatestDir, publicDataDir);
  console.log(`  ✓ Synced ${latestCount} reports from AWSReports/latest`);

  // 2. Copy accounts.json if present
  const accountsJson = path.join(awsAccountsDir, "accounts.json");
  if (fs.existsSync(accountsJson)) {
    fs.copyFileSync(accountsJson, path.join(publicDataDir, "accounts.json"));
    console.log("  ✓ Synced AWS accounts.json");
  }

  // 3. Copy per-account reports (accounts/<account-id>/latest/*)
  if (fs.existsSync(awsAccountsDir)) {
    for (const entry of fs.readdirSync(awsAccountsDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const accountLatest = path.join(awsAccountsDir, entry.name, "latest");
        const accountDest = path.join(publicDataDir, "accounts", entry.name);
        const accCount = copyDirFiles(accountLatest, accountDest);
        if (accCount > 0) {
          console.log(`  ✓ Synced ${accCount} reports for account ${entry.name}`);
        }
      }
    }
  }

  console.log("✅ AWS report synchronization complete.");
}

sync();
