import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const baseAwsReports = path.resolve(__dirname, "../../AWSReports");
const srcDir = path.resolve(baseAwsReports, "latest");
const accountsDir = path.resolve(baseAwsReports, "accounts");
const destDir = path.resolve(__dirname, "../public/data");

const srcDir2 = path.resolve(__dirname, "../../AzureDashboardReports/latest");
const destDir2 = path.resolve(__dirname, "../public/data/azure");

console.log(`Syncing CSV data from ${srcDir} to ${destDir}...`);
console.log(`Syncing Azure CSV data from ${srcDir2} to ${destDir2}...`);

try {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (fs.existsSync(destDir2)) {
    fs.rmSync(destDir2, { recursive: true, force: true });
  }
  fs.mkdirSync(destDir2, { recursive: true });

  let count = 0;

  // 1. Sync primary/latest AWS Reports
  if (fs.existsSync(srcDir)) {
    const files = fs.readdirSync(srcDir);
    for (const file of files) {
      if (file.endsWith(".csv") || file.endsWith(".json")) {
        fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
        count++;
      }
    }
  }

  // 2. Sync sub-accounts (e.g. AWSReports/accounts/account-1, account-2)
  if (fs.existsSync(accountsDir)) {
    const accountsDestDir = path.join(destDir, "accounts");
    if (!fs.existsSync(accountsDestDir)) {
      fs.mkdirSync(accountsDestDir, { recursive: true });
    }

    // Copy accounts.json if present
    const accountsJsonPath = path.join(accountsDir, "accounts.json");
    if (fs.existsSync(accountsJsonPath)) {
      fs.copyFileSync(accountsJsonPath, path.join(destDir, "accounts.json"));
    }

    const accountFolders = fs.readdirSync(accountsDir);
    for (const folder of accountFolders) {
      const accountLatest = path.join(accountsDir, folder, "latest");
      if (fs.existsSync(accountLatest) && fs.statSync(accountLatest).isDirectory()) {
        const targetDir = path.join(accountsDestDir, folder);
        if (!fs.existsSync(targetDir)) {
          fs.mkdirSync(targetDir, { recursive: true });
        }
        const accFiles = fs.readdirSync(accountLatest);
        for (const file of accFiles) {
          if (file.endsWith(".csv") || file.endsWith(".json")) {
            fs.copyFileSync(path.join(accountLatest, file), path.join(targetDir, file));
            count++;
          }
        }
      }
    }
  }

  // 3. Sync Azure Reports
  if (fs.existsSync(srcDir2)) {
    const files2 = fs.readdirSync(srcDir2);
    for (const file of files2) {
      if (file.endsWith(".csv")) {
        fs.copyFileSync(path.join(srcDir2, file), path.join(destDir2, file));
        count++;
      }
    }
  }

  console.log(`Successfully synced ${count} file(s).`);
} catch (error) {
  console.error("Failed to sync data:", error);
  process.exit(1);
}
