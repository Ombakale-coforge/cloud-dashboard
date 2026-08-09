import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, "../../AWSReports/latest");
const destDir = path.resolve(__dirname, "../public/data");

const srcDir2 = path.resolve(__dirname, "../../AzureDashboardReports/latest");
const destDir2 = path.resolve(__dirname, "../public/data/azure");

console.log(`Syncing CSV data from ${srcDir} to ${destDir}...`);
console.log(`Syncing CSV data from ${srcDir2} to ${destDir2}...`);

try {
    if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
    }

    if (fs.existsSync(destDir2)) {
        fs.rmSync(destDir2, { recursive: true, force: true });
    }
    fs.mkdirSync(destDir2, { recursive: true });

    if (!fs.existsSync(srcDir)) {
        console.warn(`Warning: Source directory ${srcDir} does not exist yet.`);
        console.warn(
            `Please run the AWS Cost Pipeline script first to generate CSV reports.`,
        );
        process.exit(0); // Exit gracefully so dev server can still start even without data initially
    }

    if (!fs.existsSync(srcDir2)) {
        console.warn(`Warning: Source directory ${srcDir2} does not exist yet.`);
        console.warn(
            `Please run the Azure Cost Pipeline script first to generate CSV reports.`,
        );
        process.exit(0); // Exit gracefully so dev server can still start even without data initially
    }

    const files = fs.readdirSync(srcDir);
    let count = 0;
    for (const file of files) {
        if (file.endsWith(".csv")) {
            fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
            count++;
        }
    }

    const files2 = fs.readdirSync(srcDir2);
    for (const file of files2) {
        if (file.endsWith(".csv")) {
            fs.copyFileSync(path.join(srcDir2, file), path.join(destDir2, file));
            count++;
        }
    }
    console.log(`Successfully synced ${count} CSV file(s).`);
} catch (error) {
    console.error("Failed to sync data:", error);
    process.exit(1);
}
