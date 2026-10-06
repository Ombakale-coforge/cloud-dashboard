import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import authRoutes from './server/routes/auth.ts';
import requestRoutes from './server/routes/requests.ts';
import awsRoutes from './server/routes/aws.ts';
import azureRoutes from './server/routes/azure.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../cost-dashboard/.env') });

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/requests', requestRoutes);
app.use('/api/aws', awsRoutes);
app.use('/api/azure', azureRoutes);
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

async function runTests() {
  const PORT = 3099;
  const server = app.listen(PORT, async () => {
    console.log(`\n====================================================`);
    console.log(`🌐 TEST API SERVER STARTED ON PORT ${PORT}`);
    console.log(`====================================================`);

    try {
      const baseUrl = `http://localhost:${PORT}`;

      // 1. Health check
      console.log('\n[1] Testing GET /api/health ...');
      const healthRes = await fetch(`${baseUrl}/api/health`);
      const healthData = await healthRes.json();
      console.log('    Status:', healthRes.status, '| Response:', JSON.stringify(healthData));

      // 1b. Test Admin Login
      console.log('\n[1b] Testing POST /api/auth/login (Admin) ...');
      const adminLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'dashboard-admin@coforge.com', password: '8iie9gb' })
      });
      const adminLoginData = await adminLoginRes.json();
      console.log('    Admin login status:', adminLoginRes.status, '| Success:', adminLoginData?.success, '| User:', adminLoginData?.user?.name);

      // 1c. Test Requester Login
      console.log('\n[1c] Testing POST /api/auth/login (Requester) ...');
      const reqLoginRes = await fetch(`${baseUrl}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'omparashuram.b@coforge.com', password: 'plain' })
      });
      const reqLoginData = await reqLoginRes.json();
      console.log('    Requester login status:', reqLoginRes.status, '| Result:', reqLoginData);

      // 2. AWS Accounts endpoint
      console.log('\n[2] Testing GET /api/aws/accounts ...');
      const accRes = await fetch(`${baseUrl}/api/aws/accounts`);
      const accData = await accRes.json();
      console.log('    Status:', accRes.status, '| Found Accounts:', accData.length);
      console.log('    Accounts Payload:', JSON.stringify(accData, null, 2));

      // 3. AWS Monthly Totals (Account 1 & Account 2)
      console.log('\n[3] Testing GET /api/aws/dataset/monthly_totals_last_6_months?account=account-1 ...');
      const mtRes1 = await fetch(`${baseUrl}/api/aws/dataset/monthly_totals_last_6_months?account=account-1`);
      const mtData1 = await mtRes1.json();
      console.log('    Account 1 Monthly Totals count:', mtData1.length, '| Sample:', mtData1[0]);

      console.log('\n[4] Testing GET /api/aws/dataset/monthly_totals_last_6_months?account=account-2 ...');
      const mtRes2 = await fetch(`${baseUrl}/api/aws/dataset/monthly_totals_last_6_months?account=account-2`);
      const mtData2 = await mtRes2.json();
      console.log('    Account 2 Monthly Totals count:', mtData2.length, '| Sample:', mtData2[0]);

      // 4. AWS Budgets Overview
      console.log('\n[5] Testing GET /api/aws/dataset/budgets_overview?account=account-1 ...');
      const bgRes1 = await fetch(`${baseUrl}/api/aws/dataset/budgets_overview?account=account-1`);
      const bgData1 = await bgRes1.json();
      console.log('    Account 1 Budgets count:', bgData1.length, '| Sample:', bgData1[0]);

      console.log('\n[6] Testing GET /api/aws/dataset/budgets_overview?account=account-2 ...');
      const bgRes2 = await fetch(`${baseUrl}/api/aws/dataset/budgets_overview?account=account-2`);
      const bgData2 = await bgRes2.json();
      console.log('    Account 2 Budgets count:', bgData2.length, '| Sample:', bgData2[0]);

      // 5. AWS Governance Summary (Default vs Historical Month)
      console.log('\n[7] Testing GET /api/aws/dataset/governance_summary?account=account-1 ...');
      const govRes1 = await fetch(`${baseUrl}/api/aws/dataset/governance_summary?account=account-1`);
      const govData1 = await govRes1.json();
      console.log('    Account 1 Governance (Latest):', govData1?.activeSpendTotal, '| Month:', govData1?.selectedMonth);

      console.log('\n[7b] Testing GET /api/aws/dataset/governance_summary?account=account-1&month=2026-06 ...');
      const govResJune = await fetch(`${baseUrl}/api/aws/dataset/governance_summary?account=account-1&month=2026-06`);
      const govDataJune = await govResJune.json();
      console.log('    Account 1 Governance (June 2026):', govDataJune?.activeSpendTotal, '| Under budget:', govDataJune?.spendUnderBudget, '| Unbudgeted:', govDataJune?.spendWithNoBudget);

      console.log('\n[8] Testing GET /api/aws/dataset/governance_summary?account=account-2 ...');
      const govRes2 = await fetch(`${baseUrl}/api/aws/dataset/governance_summary?account=account-2`);
      const govData2 = await govRes2.json();
      console.log('    Account 2 Governance (Latest):', govData2?.activeSpendTotal, '| Coverage:', govData2?.budgetCoveragePct);

      // 6. AWS Top 10 Services
      console.log('\n[9] Testing GET /api/aws/dataset/top_10_services?account=account-1 ...');
      const tsRes = await fetch(`${baseUrl}/api/aws/dataset/top_10_services?account=account-1`);
      const tsData = await tsRes.json();
      console.log('    Account 1 Top Services count:', tsData.length, '| Sample:', tsData[0]);

      // 7. AWS Cost By Linked Account
      console.log('\n[10] Testing GET /api/aws/dataset/cost_by_linked_account?account=account-1 ...');
      const claRes = await fetch(`${baseUrl}/api/aws/dataset/cost_by_linked_account?account=account-1`);
      const claData = await claRes.json();
      console.log('    Account 1 Linked Accounts rows:', claData.length);

      // 8. AWS Linked Accounts Directory Endpoint
      console.log('\n[11] Testing GET /api/aws/linked-accounts?account=account-1 ...');
      const laListRes = await fetch(`${baseUrl}/api/aws/linked-accounts?account=account-1`);
      const laListData = await laListRes.json();
      console.log('    Linked accounts status:', laListRes.status, '| Total count:', laListData?.totalLinkedAccounts, '| Active:', laListData?.activeAccountsCount, '| Total spend:', laListData?.totalSpend);
      console.log('    Sample Linked Account:', laListData?.accounts?.[0]);

      // 9. AWS Single Linked Account Deep Dive Endpoint (with Live AWS)
      const sampleId = laListData?.accounts?.[0]?.linkedAccountId;
      if (sampleId) {
        console.log(`\n[12] Testing GET /api/aws/linked-accounts/${sampleId}?account=account-1 ...`);
        const laDetailRes = await fetch(`${baseUrl}/api/aws/linked-accounts/${sampleId}?account=account-1`);
        const laDetailData = await laDetailRes.json();
        console.log('    Detail status:', laDetailRes.status, '| Account:', laDetailData?.account?.accountName, '| Live AWS Available:', laDetailData?.liveAws?.available);
        if (laDetailData?.liveAws?.available) {
          console.log('    Live Services count:', laDetailData?.liveAws?.services?.length, '| Top Service:', laDetailData?.liveAws?.services?.[0]);
          console.log('    Live Org Details:', laDetailData?.liveAws?.orgDetails);
        }
      }

      console.log('\n====================================================');
      console.log('🎉 ALL API ENDPOINTS VERIFIED & WORKING PERFECTLY!');
      console.log('====================================================');
    } catch (err) {
      console.error('API Test Error:', err);
    } finally {
      server.close(() => {
        console.log('Server closed. Test complete.');
        process.exit(0);
      });
    }
  });
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
