import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

interface AttachmentOption {
  filename: string;
  path: string;
}

function parseCliArgs() {
  const args = process.argv.slice(2);
  const flags = {
    awsOnly: args.includes('--aws'),
    azureOnly: args.includes('--azure'),
    dryRun: args.includes('--dry-run') || args.includes('--preview'),
    recipient: '',
  };

  const toArg = args.find((a) => a.startsWith('--to='));
  if (toArg) {
    flags.recipient = toArg.split('=')[1].trim();
  }

  return flags;
}

async function main() {
  const flags = parseCliArgs();
  const reportsDir = path.resolve(__dirname, '../cost-dashboard');

  const awsPdf = path.join(reportsDir, 'AWS_Manager_Cost_Budget_Report.pdf');
  const azurePdf = path.join(reportsDir, 'Azure_Manager_Cost_Budget_Report.pdf');

  const attachments: AttachmentOption[] = [];

  // Determine attachments based on CLI flags
  if (!flags.azureOnly && fs.existsSync(awsPdf)) {
    attachments.push({
      filename: 'AWS_Manager_Cost_Budget_Report.pdf',
      path: awsPdf,
    });
  }

  if (!flags.awsOnly && fs.existsSync(azurePdf)) {
    attachments.push({
      filename: 'Azure_Manager_Cost_Budget_Report.pdf',
      path: azurePdf,
    });
  }

  if (attachments.length === 0) {
    console.error('❌ No PDF reports found in cost-dashboard to send.');
    console.error('   Please run `npm run report:aws:pdf` or `npm run report:azure:pdf` first.');
    process.exit(1);
  }

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const smtpUser = process.env.SMTP_USER;
  const rawPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '';
  const smtpPass = rawPass.trim().replace(/\s+/g, '');

  const fromEmail = process.env.ALERT_EMAIL_FROM || process.env.EMAIL_FROM || smtpUser || 'finops@coforge.com';
  const toEmail = flags.recipient || process.env.ALERT_EMAIL_TO || process.env.EMAIL_TO || process.env.ADMIN_EMAIL;

  console.log(`📦 Found ${attachments.length} report(s) to send:`);
  attachments.forEach((a) => console.log(`   - ${a.filename} (${(fs.statSync(a.path).size / 1024).toFixed(1)} KB)`));

  if (!toEmail) {
    console.error('❌ Recipient email not specified. Set ALERT_EMAIL_TO in .env or pass --to="email@domain.com"');
    process.exit(1);
  }

  const subject = `Executive Cloud Cost & Budget Report - ${new Date().toISOString().slice(0, 10)}`;
  const textBody = `Hello,\n\nPlease find attached the latest Executive Cloud Cost & Budget Reports.\n\nAttached:\n${attachments
    .map((a) => `• ${a.filename}`)
    .join('\n')}\n\nGenerated: ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}\n\n— Coforge Cloud Cost Intelligence`;

  const htmlBody = `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a; line-height: 1.5; max-width: 600px; padding: 20px;">
      <h2 style="color: #0f172a; margin-top: 0;">Executive Cloud Cost &amp; Budget Report</h2>
      <p>Please find attached the latest executive report PDFs for your cloud infrastructure:</p>
      <ul style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 12px 24px; margin: 16px 0;">
        ${attachments.map((a) => `<li style="margin: 4px 0;"><strong>${a.filename}</strong></li>`).join('')}
      </ul>
      <p style="font-size: 13px; color: #64748b; margin-top: 20px;">
        Generated on ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}<br/>
        Coforge Cloud Cost Intelligence &amp; FinOps Governance
      </p>
    </div>
  `;

  if (flags.dryRun || !smtpHost || !smtpUser) {
    console.log('\n⚠️ DRY RUN / Missing SMTP credentials in .env');
    console.log(`   From: ${fromEmail}`);
    console.log(`   To:   ${toEmail}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Attachments: ${attachments.map((a) => a.filename).join(', ')}`);
    console.log('💡 To send for real, ensure SMTP_HOST, SMTP_PORT, SMTP_USER, and SMTP_PASSWORD are set in .env.');
    process.exit(0);
  }

  console.log(`📧 Sending email via ${smtpHost}:${smtpPort} to ${toEmail}...`);

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpSecure,
    auth: {
      user: smtpUser,
      pass: smtpPass,
    },
  });

  const info = await transporter.sendMail({
    from: fromEmail,
    to: toEmail,
    subject,
    text: textBody,
    html: htmlBody,
    attachments: attachments.map((a) => ({
      filename: a.filename,
      path: a.path,
    })),
  });

  console.log(`✅ Email successfully sent! Message ID: ${info.messageId}`);
}

main().catch((err) => {
  console.error('❌ Failed to send email:', err.message);
  process.exit(1);
});
