import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const srcDir = path.resolve(__dirname, '../../AWSReports/latest');
const destDir = path.resolve(__dirname, '../public/data');

console.log(`Syncing CSV data from ${srcDir} to ${destDir}...`);

try {
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }

  if (!fs.existsSync(srcDir)) {
    console.warn(`Warning: Source directory ${srcDir} does not exist yet.`);
    console.warn(`Please run the AWS Cost Pipeline script first to generate CSV reports.`);
    process.exit(0); // Exit gracefully so dev server can still start even without data initially
  }

  const files = fs.readdirSync(srcDir);
  let count = 0;
  for (const file of files) {
    if (file.endsWith('.csv')) {
      fs.copyFileSync(path.join(srcDir, file), path.join(destDir, file));
      count++;
    }
  }
  console.log(`Successfully synced ${count} CSV file(s).`);
} catch (error) {
  console.error('Failed to sync data:', error);
  process.exit(1);
}
