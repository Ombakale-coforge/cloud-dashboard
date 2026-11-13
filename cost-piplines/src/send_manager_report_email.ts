import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import nodemailer from 'nodemailer';
import { ClientSecretCredential } from '@azure/identity';

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
    gcpOnly: args.includes('--gcp'),
    azureOnly: args.includes('--azure'),
    dryRun: args.includes('--dry-run') || args.includes('--preview'),
    smtp: args.includes('--smtp'),
    noPdf: args.includes('--no-pdf'),
    cached: args.includes('--cached') || args.includes('--no-generate'),
    recipient: '',
  };

  // Deliberately no --from flag: the Graph sender is always SENDER_EMAIL from .env.
  const toArg = args.find((a) => a.startsWith('--to='));
  if (toArg) {
    flags.recipient = toArg.slice('--to='.length).trim();
  }

  return flags;
}

function extractStyleAndBody(fullHtml: string): { style: string; body: string } {
  const styleMatch = fullHtml.match(/<style[^>]*>([\s\S]*?)<\/style>/i);
  let style = styleMatch ? styleMatch[1] : '';

  // Remove @page rules from embedded email CSS
  style = style.replace(/@page\s*\{[\s\S]*?\}/gi, '');

  const bodyMatch = fullHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
  let body = bodyMatch ? bodyMatch[1] : fullHtml;

  // Strip standalone <html> or <body> tags if left
  body = body
    .replace(/<!DOCTYPE[^>]*>/gi, '')
    .replace(/<\/?html[^>]*>/gi, '')
    .replace(/<\/?body[^>]*>/gi, '');

  return { style, body };
}

async function prepareFreshReport(
  cloud: 'aws' | 'gcp' | 'azure',
  reportsDir: string,
  options: { noPdf?: boolean; cached?: boolean }
): Promise<string> {
  const filename =
    cloud === 'aws'
      ? 'AWS_Manager_Cost_Budget_Report.html'
      : cloud === 'gcp'
      ? 'GCP_Manager_Cost_Budget_Report.html'
      : 'Azure_Manager_Cost_Budget_Report.html';
  const htmlPath = path.join(reportsDir, filename);

  if (options.cached && fs.existsSync(htmlPath)) {
    console.log(`⚡ Using cached ${cloud.toUpperCase()} report HTML (--cached)`);
    return fs.readFileSync(htmlPath, 'utf-8');
  }

  console.log(`🔄 Generating fresh ${cloud.toUpperCase()} report & PDF (replacing existing)...`);
  if (cloud === 'aws') {
    const { generateAwsReport } = await import(
      './generate_manager_report_pdf.ts'
    );
    await generateAwsReport({ htmlOnly: !!options.noPdf });
  } else if (cloud === 'gcp') {
    const { generateGcpReport } = await import(
      './generate_gcp_manager_report_pdf.ts'
    );
    await generateGcpReport({ htmlOnly: !!options.noPdf });
  } else {
    const { generateAzureReport } = await import(
      './generate_azure_manager_report_pdf.ts'
    );
    await generateAzureReport({ htmlOnly: !!options.noPdf });
  }

  if (fs.existsSync(htmlPath)) {
    return fs.readFileSync(htmlPath, 'utf-8');
  }
  throw new Error(`Report HTML was not produced at ${htmlPath}`);
}

function assembleConsolidatedEmail(params: {
  awsHtml?: string;
  gcpHtml?: string;
  azureHtml?: string;
  generatedDate: string;
}): string {
  const { awsHtml, gcpHtml, azureHtml, generatedDate } = params;

  let combinedStyles = `
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      color: #0f172a;
      -webkit-font-smoothing: antialiased;
    }
    .email-wrapper {
      width: 100%;
      background-color: #f1f5f9;
      padding: 24px 10px;
    }
    .email-container {
      max-width: 820px;
      margin: 0 auto;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
      padding: 20px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);
    }
    .section-divider {
      height: 2px;
      background: #e2e8f0;
      margin: 28px 0;
      border: none;
    }
    .footer {
      margin-top: 24px;
      padding-top: 14px;
      border-top: 1px solid #e2e8f0;
      text-align: center;
      font-size: 10px;
      color: #64748b;
      line-height: 1.5;
    }
  `;

  // Collect sections in exact requested order: 1. AWS -> 2. GCP -> 3. Azure
  const orderedSections: Array<{ label: string; style: string; body: string }> = [];

  if (awsHtml) {
    const aws = extractStyleAndBody(awsHtml);
    orderedSections.push({ label: 'AWS', style: aws.style, body: aws.body });
  }
  if (gcpHtml) {
    const gcp = extractStyleAndBody(gcpHtml);
    orderedSections.push({ label: 'GCP', style: gcp.style, body: gcp.body });
  }
  if (azureHtml) {
    const az = extractStyleAndBody(azureHtml);
    orderedSections.push({ label: 'Azure', style: az.style, body: az.body });
  }

  for (const sec of orderedSections) {
    combinedStyles += `\n${sec.style}`;
  }

  let bodyContent = '';

  if (orderedSections.length > 1) {
    const labelsText = orderedSections
      .map((s) => s.label)
      .join(', ')
      .replace(/, ([^,]*)$/, ' &amp; $1');

    bodyContent = `
      <!-- Consolidated Header -->
      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="width: 100%; background: linear-gradient(135deg, #090d16 0%, #0f172a 50%, #1e293b 100%); color: #ffffff; border-radius: 10px; padding: 18px 22px; margin-bottom: 20px;">
        <tr>
          <td align="left" style="vertical-align: middle;">
            <div style="font-size: 19px; font-weight: 800; letter-spacing: -0.3px; color: #ffffff;">Executive Multi-Cloud Cost &amp; Budget Report</div>
            <div style="font-size: 11.5px; color: #94a3b8; margin-top: 3px;">Coforge Cloud Cost Intelligence &bull; Unified ${labelsText} Executive Summary</div>
          </td>
          <td align="right" style="vertical-align: middle;">
            <div style="display: inline-block; background: rgba(255,255,255,0.12); border: 1px solid rgba(255,255,255,0.25); color: #ffffff; font-weight: 700; font-size: 10.5px; padding: 3px 10px; border-radius: 6px; margin-bottom: 3px;">
              Consolidated View
            </div>
            <div style="font-size: 10px; color: #94a3b8;">Generated: ${generatedDate}</div>
          </td>
        </tr>
      </table>

      ${orderedSections
        .map(
          (sec, idx) =>
            `<!-- ${idx + 1}. ${sec.label} Cloud Report Section -->\n${sec.body}`
        )
        .join('\n\n      <div class="section-divider"></div>\n\n      ')}
    `;
  } else if (orderedSections.length === 1) {
    bodyContent = orderedSections[0].body;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Executive Cloud Cost &amp; Budget Report</title>
  <style>
    ${combinedStyles}
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9;">
  <div class="email-wrapper">
    <div class="email-container">
      ${bodyContent}
      <div class="footer">
        Confidential — Coforge Cloud Cost Intelligence &amp; FinOps Governance Platform<br/>
        This automated executive report was dispatched on ${generatedDate}.
      </div>
    </div>
  </div>
</body>
</html>`;
}

// ponytail: sendMail with inline attachments is limited to ~3 MB per file; larger PDFs need a Graph upload session.
async function sendViaGraph(
  sender: string,
  recipients: string[],
  subject: string,
  html: string,
  attachments: AttachmentOption[]
): Promise<void> {
  const credential = new ClientSecretCredential(
    process.env.AZURE_TENANT_ID as string,
    process.env.AZURE_CLIENT_ID as string,
    process.env.AZURE_CLIENT_SECRET as string
  );
  const { token } = await credential.getToken('https://graph.microsoft.com/.default');

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'HTML', content: html },
          toRecipients: recipients.map((address) => ({ emailAddress: { address } })),
          attachments: attachments.map((a) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: a.filename,
            contentType: 'application/pdf',
            contentBytes: fs.readFileSync(a.path).toString('base64'),
          })),
        },
        saveToSentItems: true,
      }),
    }
  );

  if (res.status !== 202) {
    throw new Error(
      `Graph sendMail failed (${res.status}): ${await res.text()}\n` +
        '   403 / ErrorAccessDenied usually means Mail.Send is missing or admin consent has not been granted.'
    );
  }
}

async function main() {
  const flags = parseCliArgs();
  const reportsDir = path.resolve(__dirname, '../cost-dashboard');

  const hasCloudFilter = flags.awsOnly || flags.gcpOnly || flags.azureOnly;
  const includeAws = !hasCloudFilter || flags.awsOnly;
  const includeGcp = !hasCloudFilter || flags.gcpOnly;
  const includeAzure = !hasCloudFilter || flags.azureOnly;

  let awsHtml: string | undefined;
  let gcpHtml: string | undefined;
  let azureHtml: string | undefined;

  // 1. Generate fresh AWS report & PDF (1st)
  if (includeAws) {
    try {
      awsHtml = await prepareFreshReport('aws', reportsDir, {
        noPdf: flags.noPdf,
        cached: flags.cached,
      });
    } catch (err: any) {
      console.warn(`⚠️ Could not generate fresh AWS report: ${err.message}`);
    }
  }

  // 2. Generate fresh GCP report & PDF (2nd)
  if (includeGcp) {
    try {
      gcpHtml = await prepareFreshReport('gcp', reportsDir, {
        noPdf: flags.noPdf,
        cached: flags.cached,
      });
    } catch (err: any) {
      console.warn(`⚠️ Could not generate fresh GCP report: ${err.message}`);
    }
  }

  // 3. Generate fresh Azure report & PDF (3rd)
  if (includeAzure) {
    try {
      azureHtml = await prepareFreshReport('azure', reportsDir, {
        noPdf: flags.noPdf,
        cached: flags.cached,
      });
    } catch (err: any) {
      console.warn(`⚠️ Could not generate fresh Azure report: ${err.message}`);
    }
  }

  if (!awsHtml && !gcpHtml && !azureHtml) {
    console.error('❌ No report data available to send in email body.');
    console.error(
      '   Please run `npm run report:aws:html`, `npm run report:gcp:html`, or `npm run report:azure:html` first.'
    );
    process.exit(1);
  }

  const generatedDate = new Date().toISOString().slice(0, 10);
  const consolidatedHtml = assembleConsolidatedEmail({
    awsHtml,
    gcpHtml,
    azureHtml,
    generatedDate,
  });

  // Attach generated PDFs in order (AWS -> GCP -> Azure) unless --no-pdf is specified
  const attachments: AttachmentOption[] = [];
  if (!flags.noPdf) {
    const awsPdf = path.join(reportsDir, 'AWS_Manager_Cost_Budget_Report.pdf');
    const gcpPdf = path.join(reportsDir, 'GCP_Manager_Cost_Budget_Report.pdf');
    const azurePdf = path.join(reportsDir, 'Azure_Manager_Cost_Budget_Report.pdf');

    if (includeAws && fs.existsSync(awsPdf)) {
      attachments.push({ filename: 'AWS_Manager_Cost_Budget_Report.pdf', path: awsPdf });
    }
    if (includeGcp && fs.existsSync(gcpPdf)) {
      attachments.push({ filename: 'GCP_Manager_Cost_Budget_Report.pdf', path: gcpPdf });
    }
    if (includeAzure && fs.existsSync(azurePdf)) {
      attachments.push({ filename: 'Azure_Manager_Cost_Budget_Report.pdf', path: azurePdf });
    }
    if (attachments.length > 0) {
      console.log(`📎 Found ${attachments.length} executive PDF report(s) to attach.`);
    }
  } else {
    console.log('📎 Attachment flag --no-pdf specified: sending in-body HTML only.');
  }

  const recipients = (flags.recipient || process.env.ALERT_EMAIL_TO || process.env.EMAIL_TO || '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);

  const senderEmail = process.env.SENDER_EMAIL?.trim();
  const useGraph =
    !flags.smtp &&
    !!senderEmail &&
    !!process.env.AZURE_TENANT_ID &&
    !!process.env.AZURE_CLIENT_ID &&
    !!process.env.AZURE_CLIENT_SECRET;

  const smtpHost = process.env.SMTP_HOST;
  const smtpPort = Number(process.env.SMTP_PORT || '587');
  const smtpSecure = String(process.env.SMTP_SECURE || 'false').toLowerCase() === 'true';
  const smtpUser = process.env.SMTP_USER;
  const rawPass = process.env.SMTP_PASSWORD || process.env.SMTP_PASS || '';
  const smtpPass = rawPass.trim().replace(/\s+/g, '');
  const smtpFrom = process.env.ALERT_EMAIL_FROM || process.env.EMAIL_FROM || smtpUser || 'finops@coforge.com';
  const smtpReady = !!smtpHost && !!smtpUser;

  if (recipients.length === 0) {
    console.error('❌ Recipient email not specified. Set ALERT_EMAIL_TO in .env or pass --to="email@domain.com"');
    process.exit(1);
  }

  const activeCloudLabels = [
    awsHtml ? 'AWS' : '',
    gcpHtml ? 'GCP' : '',
    azureHtml ? 'Azure' : '',
  ].filter(Boolean);

  let subject = `Executive Multi-Cloud Cost & Budget Report - ${generatedDate}`;
  if (activeCloudLabels.length === 1) {
    subject = `${activeCloudLabels[0]} Executive Cost & Budget Report - ${generatedDate}`;
  }

  const textBody = `Executive Cloud Cost & Budget Report - ${generatedDate}
Coforge Cloud Cost Intelligence & FinOps Governance

This report has been formatted as an interactive rich HTML email. The complete executive reports (${activeCloudLabels.join(', ')}) are rendered directly in the message body, and official PDF copies are also attached for offline download and archival.

Report Sections Included:
${activeCloudLabels.map((label, idx) => `• ${idx + 1}. ${label} Cloud Cost & Budget Executive Report`).join('\n')}
${attachments.length > 0 ? `\nAttached Documents:\n${attachments.map((a) => `• ${a.filename}`).join('\n')}\n` : ''}
Generated: ${new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
— Coforge FinOps Team`;

  const transport = useGraph ? 'Microsoft Graph' : 'SMTP';
  const previewPath = path.join(reportsDir, 'preview_email_body.html');
  fs.writeFileSync(previewPath, consolidatedHtml, 'utf-8');

  console.log(`📧 Report Email Assembly Complete:`);
  console.log(`   - Sections: ${activeCloudLabels.join(' -> ')}`);
  console.log(`   - In-Body HTML Size: ${(consolidatedHtml.length / 1024).toFixed(1)} KB`);
  console.log(`   - Attachments: ${attachments.length > 0 ? attachments.map((a) => a.filename).join(', ') : 'None (In-body report)'}`);
  console.log(`   - Local Preview: ${previewPath}`);

  if (flags.dryRun || (!useGraph && !smtpReady)) {
    console.log(`\n⚠️ ${flags.dryRun ? 'DRY RUN' : 'No email transport configured'} (transport: ${transport})`);
    console.log(`   From:    ${useGraph ? senderEmail : smtpFrom}`);
    console.log(`   To:      ${recipients.join(', ')}`);
    console.log(`   Subject: ${subject}`);
    console.log(`   Body:    Rich in-body HTML (${consolidatedHtml.length} characters)`);
    if (!flags.dryRun) {
      console.log(
        '💡 Set SENDER_EMAIL + AZURE_TENANT_ID/CLIENT_ID/CLIENT_SECRET for Microsoft Graph, or SMTP_HOST/SMTP_USER/SMTP_PASSWORD for SMTP.'
      );
    }
    process.exit(0);
  }

  if (useGraph) {
    console.log(`📧 Sending as ${senderEmail} via Microsoft Graph to ${recipients.join(', ')}...`);
    await sendViaGraph(senderEmail as string, recipients, subject, consolidatedHtml, attachments);
    console.log('✅ Email accepted by Microsoft Graph (202). It will appear in the sender\'s Sent Items.');
    return;
  }

  console.log(`📧 Sending email via ${smtpHost}:${smtpPort} to ${recipients.join(', ')}...`);

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
    from: smtpFrom,
    to: recipients,
    subject,
    text: textBody,
    html: consolidatedHtml,
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
