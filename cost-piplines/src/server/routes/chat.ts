import { Router, Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { prisma } from '../db.ts';
import {
  APP_SYSTEM_CONTEXT,
  getSmartFallbackReply,
} from '../../../cost-dashboard/src/lib/chatbotKnowledge.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const router = Router();

interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/* ─────────────── Hard Monthly Spend Cap Ledger ($10.00 default) ─────────────── */

interface AiSpendLedger {
  month: string;
  promptTokens: number;
  completionTokens: number;
  totalCalls: number;
  spentUsd: number;
  updatedAt: string;
}

const LEDGER_FILE = path.resolve(__dirname, 'ai-spend-ledger.json');

function getCurrentYearMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

function readSpendLedger(): AiSpendLedger {
  const currentMonth = getCurrentYearMonth();
  try {
    if (fs.existsSync(LEDGER_FILE)) {
      const raw = JSON.parse(fs.readFileSync(LEDGER_FILE, 'utf-8'));
      if (raw && raw.month === currentMonth) {
        return raw;
      }
    }
  } catch {
    // Ignore corrupt file and initialize fresh
  }
  return {
    month: currentMonth,
    promptTokens: 0,
    completionTokens: 0,
    totalCalls: 0,
    spentUsd: 0,
    updatedAt: new Date().toISOString(),
  };
}

function recordTokenSpend(
  modelName: string,
  promptTokens: number,
  completionTokens: number
): AiSpendLedger {
  const ledger = readSpendLedger();
  const isMini = modelName.toLowerCase().includes('mini');

  // Official Azure OpenAI Global Standard pricing per 1M tokens:
  // gpt-4o: $2.50 / 1M input, $10.00 / 1M output
  // gpt-4o-mini: $0.15 / 1M input, $0.60 / 1M output
  const inputRatePerMillion = isMini ? 0.15 : 2.5;
  const outputRatePerMillion = isMini ? 0.6 : 10.0;

  const callCostUsd =
    (promptTokens / 1_000_000) * inputRatePerMillion +
    (completionTokens / 1_000_000) * outputRatePerMillion;

  ledger.promptTokens += promptTokens;
  ledger.completionTokens += completionTokens;
  ledger.totalCalls += 1;
  ledger.spentUsd = Number((ledger.spentUsd + callCostUsd).toFixed(6));
  ledger.updatedAt = new Date().toISOString();

  try {
    fs.writeFileSync(LEDGER_FILE, JSON.stringify(ledger, null, 2), 'utf-8');
  } catch (err: any) {
    console.warn('⚠️ [AI Spend Ledger] Could not write ledger:', err.message);
  }

  return ledger;
}

function getSpendBudgetStatus() {
  const capUsd = Math.max(
    0.01,
    Number(process.env.AZURE_OPENAI_MONTHLY_CAP_USD || 10)
  );
  const ledger = readSpendLedger();
  const isCapped = ledger.spentUsd >= capUsd;
  const remainingUsd = Math.max(0, Number((capUsd - ledger.spentUsd).toFixed(4)));

  return {
    month: ledger.month,
    capUsd,
    spentUsd: Number(ledger.spentUsd.toFixed(4)),
    remainingUsd,
    totalCalls: ledger.totalCalls,
    promptTokens: ledger.promptTokens,
    completionTokens: ledger.completionTokens,
    isCapped,
  };
}

/* ─────────────── Live SQL Server Cost & Request Context ─────────────── */

let cachedCostSnapshot = '';
let cachedCostTimestamp = 0;

async function buildLiveAppDataSnapshot(
  userRole: string,
  userEmail: string
): Promise<string> {
  if (!prisma) return '';

  const sections: string[] = [];

  try {
    const now = Date.now();
    if (!cachedCostSnapshot || now - cachedCostTimestamp > 60_000) {
      const costLines: string[] = [];

      // 1. AWS Accounts, Monthly Totals, Budgets, Governance, Forecasts
      const awsAccounts = await prisma.awsAccount.findMany({
        where: { isActive: true },
        orderBy: { id: 'asc' },
      });

      for (const acc of awsAccounts) {
        const latestRun = await prisma.awsReportRun.findFirst({
          where: { accountId: acc.id, status: 'success' },
          orderBy: { id: 'desc' },
        });
        if (!latestRun) continue;

        const [
          totals,
          momChanges,
          topServices,
          gov,
          budgets,
          unbudgeted,
          forecasts,
        ] = await Promise.all([
          prisma.awsMonthlyTotal.findMany({
            where: { reportRunId: latestRun.id },
            orderBy: { month: 'asc' },
          }),
          prisma.awsMomChange.findMany({
            where: { reportRunId: latestRun.id },
            orderBy: { month: 'asc' },
          }),
          prisma.awsTopService.findMany({
            where: { reportRunId: latestRun.id },
            orderBy: { rank: 'asc' },
            take: 8,
          }),
          prisma.awsGovernanceSummary.findUnique({
            where: { reportRunId: latestRun.id },
          }),
          prisma.awsBudgetOverview.findMany({
            where: { reportRunId: latestRun.id },
            orderBy: { limitAmount: 'desc' },
            take: 25,
          }),
          prisma.awsUnbudgetedAccount.findMany({
            where: { reportRunId: latestRun.id },
            orderBy: { currentMonthSpend: 'desc' },
            take: 10,
          }),
          prisma.awsForecast.findMany({
            where: { reportRunId: latestRun.id },
            orderBy: { forecastMonth: 'asc' },
          }),
        ]);

        const momByMonth = new Map(momChanges.map((m) => [m.month, m]));

        const recentTotals = totals
          .slice(-6)
          .map((t) => {
            const mom = momByMonth.get(t.month);
            const pctStr =
              mom?.momPercentChange != null
                ? ` (${Number(mom.momPercentChange) >= 0 ? '+' : ''}${Number(
                    mom.momPercentChange
                  ).toFixed(1)}% MoM)`
                : '';
            return `${t.month}: $${Number(t.totalCost).toLocaleString()} USD${pctStr}`;
          })
          .join(' | ');

        const topSvcStr = topServices
          .map(
            (s) =>
              `#${s.rank} ${s.service}: $${Number(s.cost).toLocaleString()}`
          )
          .join(', ');

        costLines.push(
          `#### AWS Account: "${acc.name}" (Account ID: ${
            acc.awsAccountId || acc.configId
          }, Latest Report Month: ${latestRun.currentMonth || 'N/A'})`
        );
        if (recentTotals) {
          costLines.push(
            `- **Monthly Spend History (Last 6 Months)**: ${recentTotals}`
          );
        }
        if (topSvcStr) {
          costLines.push(
            `- **Top Services (${latestRun.currentMonth})**: ${topSvcStr}`
          );
        }
        if (gov) {
          costLines.push(
            `- **AWS Organization & Budget Governance (${gov.selectedMonth})**:
  • Total Org Accounts: ${gov.totalAccounts} (${gov.activeAccounts} Active, ${gov.suspendedAccounts} Suspended)
  • Accounts With Budget: ${gov.accountsWithBudget} | Accounts Without Budget: ${gov.accountsWithNoBudget}
  • Total Sum of AWS Budget Limits: $${Number(gov.sumBudgetLimits).toLocaleString()} USD
  • Active Spend Total: $${Number(gov.activeSpendTotal).toLocaleString()} USD
  • Spend Covered Under Budgets: $${Number(gov.spendUnderBudget).toLocaleString()} USD (${Number(gov.budgetCoveragePct).toFixed(1)}% coverage)
  • Unbudgeted Spend: $${Number(gov.spendWithNoBudget).toLocaleString()} USD (${Number(gov.shareSpendUncoveredPct).toFixed(1)}% uncovered)`
          );
        }
        if (budgets.length > 0) {
          const budgetList = budgets
            .map(
              (b) =>
                `  • "${b.budgetName}": Limit $${Number(
                  b.limitAmount
                ).toLocaleString()} | Used $${Number(
                  b.currentUsed
                ).toLocaleString()} (${Number(
                  b.currentVsBudgetPercent
                ).toFixed(1)}%) | Forecast $${Number(
                  b.forecastedSpend
                ).toLocaleString()} | Status: ${b.thresholdStatus} (${
                  b.healthStatus
                })`
            )
            .join('\n');
          costLines.push(
            `- **Individual AWS Budgets (${budgets.length} configured)**:\n${budgetList}`
          );
        }
        if (unbudgeted.length > 0) {
          const unbList = unbudgeted
            .slice(0, 5)
            .map(
              (u) =>
                `${u.accountName} (${u.awsAccountId}): $${Number(
                  u.currentMonthSpend
                ).toLocaleString()} (Top driver: ${u.topCostDriver || 'N/A'})`
            )
            .join(', ');
          costLines.push(`- **Top Unbudgeted Linked Accounts**: ${unbList}`);
        }
        if (forecasts.length > 0) {
          const fcStr = forecasts
            .map(
              (f) =>
                `${f.forecastMonth}: $${Number(
                  f.projectedCost
                ).toLocaleString()} (${f.method})`
            )
            .join(', ');
          costLines.push(`- **Projected AWS Forecast**: ${fcStr}`);
        }
      }

      // 2. Azure Monthly Totals & Subscription Budgets
      const latestAzureRun = await (prisma as any).azureReportRun
        ?.findFirst({ where: { status: 'success' }, orderBy: { id: 'desc' } })
        .catch(() => null);

      const [azureMonthly, azureSubBudgets] = await Promise.all([
        latestAzureRun
          ? ((prisma as any).azureReportMonthlyTotals
              ?.findMany({
                where: { reportRunId: latestAzureRun.id },
                orderBy: { month: 'asc' },
                take: 6,
              })
              .catch(() => []) ?? [])
          : [],
        (prisma as any).azureSubscriptionBudget
          ?.findMany({ orderBy: { amount: 'desc' }, take: 15 })
          .catch(() => []) ?? [],
      ]);

      if (azureMonthly.length > 0 || azureSubBudgets.length > 0) {
        costLines.push(`#### Azure Cloud Spend & Budgets`);
        if (azureMonthly.length > 0) {
          const azStr = azureMonthly
            .map(
              (m: any) =>
                `${m.month}: ${Number(m.totalCost).toLocaleString()} (Billing Currency)`
            )
            .join(' | ');
          costLines.push(`- **Azure Monthly Totals**: ${azStr}`);
        }
        if (azureSubBudgets.length > 0) {
          const azBStr = azureSubBudgets
            .map(
              (b: any) =>
                `  • ${b.subscriptionName || b.subscriptionId} (${
                  b.budgetName
                }): Limit ${
                  b.amount != null ? Number(b.amount).toLocaleString() : 'N/A'
                } (${b.timeGrain}, Status: ${b.status})`
            )
            .join('\n');
          costLines.push(`- **Azure Subscription Budgets**:\n${azBStr}`);
        }
      }

      cachedCostSnapshot = costLines.join('\n');
      cachedCostTimestamp = now;
    }

    if (cachedCostSnapshot) {
      sections.push(
        `### LIVE CLOUD SPEND, BUDGETS & GOVERNANCE DATA (FROM SQL SERVER)\n${cachedCostSnapshot}`
      );
    }

    // 3. Live AWS Account Provisioning Requests Snapshot (Role-Aware)
    const allRequests = await (prisma as any).accountRequest
      ?.findMany({
        orderBy: { submittedAt: 'desc' },
        take: 15,
      })
      .catch(() => []);

    if (Array.isArray(allRequests) && allRequests.length > 0) {
      const normEmail = (userEmail || '').toLowerCase().trim();
      const visibleRequests =
        userRole === 'admin'
          ? allRequests
          : allRequests.filter(
              (r: any) =>
                (r.submitterEmail || '').toLowerCase() === normEmail ||
                (r.pointOfContact || '').toLowerCase() === normEmail
            );

      const pendingCount = visibleRequests.filter(
        (r: any) => (r.status || 'pending').toLowerCase() === 'pending'
      ).length;
      const approvedCount = visibleRequests.filter(
        (r: any) => (r.status || '').toLowerCase() === 'approved'
      ).length;
      const rejectedCount = visibleRequests.filter(
        (r: any) => (r.status || '').toLowerCase() === 'rejected'
      ).length;

      const reqLines = visibleRequests.slice(0, 8).map((r: any) => {
        return `  • [${(r.status || 'pending').toUpperCase()}] Project: "${
          r.projectName
        }" (${r.division}) | Est. Cost: $${Number(
          r.estimatedMonthlyCost || 0
        ).toLocaleString()}/mo | Submitter: ${r.submitterEmail}${
          r.adminNotes ? ` | Admin Note: "${r.adminNotes}"` : ''
        }`;
      });

      sections.push(
        `### LIVE AWS ACCOUNT REQUESTS (${
          userRole === 'admin' ? 'ALL SUBMISSIONS' : 'CURRENT USER SUBMISSIONS'
        })\n- Summary: ${visibleRequests.length} total (${pendingCount} Pending, ${approvedCount} Approved, ${rejectedCount} Rejected)\n${reqLines.join(
          '\n'
        )}`
      );
    }
  } catch (err: any) {
    console.warn(
      '⚠️ [Chat Live Snapshot] Non-fatal error reading DB:',
      err.message
    );
  }

  return sections.join('\n\n');
}

function getAiProviderConfig() {
  // Hot-reload .env so newly added keys work without server restart
  dotenv.config({
    path: path.resolve(__dirname, '../../../.env'),
    override: true,
  });
  dotenv.config({
    path: path.resolve(__dirname, '../../../cost-dashboard/.env'),
    override: true,
  });

  // 1. Check Azure OpenAI
  const rawAzureEndpoint = (process.env.AZURE_OPENAI_ENDPOINT || '').trim();
  const azureApiKey = (process.env.AZURE_OPENAI_API_KEY || '').trim();
  const azureDeployment = (
    process.env.AZURE_OPENAI_DEPLOYMENT ||
    process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
    'gpt-4o'
  ).trim();
  const azureApiVersion = (
    process.env.AZURE_OPENAI_API_VERSION || '2024-08-01-preview'
  ).trim();

  if (
    rawAzureEndpoint &&
    azureApiKey &&
    !rawAzureEndpoint.includes('your-resource-name') &&
    !azureApiKey.includes('your-azure-openai-api-key')
  ) {
    let url = '';
    if (rawAzureEndpoint.includes('/openai/deployments/')) {
      url = rawAzureEndpoint;
    } else {
      const cleanBase = rawAzureEndpoint.replace(/\/+$/, '');
      url = `${cleanBase}/openai/deployments/${encodeURIComponent(
        azureDeployment
      )}/chat/completions?api-version=${encodeURIComponent(azureApiVersion)}`;
    }
    return {
      configured: true,
      provider: 'azure-openai' as const,
      label: 'Azure OpenAI',
      url,
      apiKey: azureApiKey,
      model: azureDeployment,
    };
  }

  // 2. Check Google Gemini (Free via aistudio.google.com/apikey)
  const geminiKey = (process.env.GEMINI_API_KEY || '').trim();
  const geminiModel = (process.env.GEMINI_MODEL || 'gemini-2.5-flash').trim();
  if (geminiKey && !geminiKey.includes('your-gemini-api-key')) {
    return {
      configured: true,
      provider: 'gemini' as const,
      label: 'Gemini AI',
      url: `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`,
      apiKey: geminiKey,
      model: geminiModel,
    };
  }

  // 3. Check Groq (Free via console.groq.com/keys)
  const groqKey = (process.env.GROQ_API_KEY || '').trim();
  const groqModel = (
    process.env.GROQ_MODEL || 'llama-3.3-70b-versatile'
  ).trim();
  if (groqKey && !groqKey.includes('your-groq-api-key')) {
    return {
      configured: true,
      provider: 'groq' as const,
      label: 'Groq AI',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groqKey,
      model: groqModel,
    };
  }

  // 4. Check Standard OpenAI
  const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
  const openaiModel = (process.env.OPENAI_MODEL || 'gpt-4o-mini').trim();
  if (openaiKey && !openaiKey.includes('your-openai-api-key')) {
    return {
      configured: true,
      provider: 'openai' as const,
      label: 'OpenAI',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: openaiKey,
      model: openaiModel,
    };
  }

  return {
    configured: false,
    provider: 'smart-knowledge-base' as const,
    label: 'AI Concierge',
    url: '',
    apiKey: '',
    model: null,
  };
}

// Check AI status & $10 cap usage
router.get('/status', (_req: Request, res: Response) => {
  const cfg = getAiProviderConfig();
  const budget = getSpendBudgetStatus();
  res.json({
    configured: cfg.configured && !budget.isCapped,
    provider: budget.isCapped ? 'smart-knowledge-base' : cfg.provider,
    label: budget.isCapped
      ? `Cap Reached ($${budget.capUsd})`
      : cfg.label,
    deployment: cfg.model,
    budget,
  });
});

// Main Chat Endpoint
router.post('/', async (req: Request, res: Response) => {
  try {
    const {
      message = '',
      history = [],
      currentPath = '/',
      userRole = 'basic',
      userName = '',
      userEmail = '',
    } = req.body || {};

    const trimmedMessage = String(message).trim();
    if (!trimmedMessage) {
      return res.status(400).json({ error: 'Message is required' });
    }

    const cfg = getAiProviderConfig();
    const budget = getSpendBudgetStatus();
    const liveDataSnapshot = await buildLiveAppDataSnapshot(
      userRole,
      userEmail
    );

    // Hard $10 Cap Check: Only call Azure OpenAI if under the monthly $10 cap
    if (cfg.configured && cfg.url && !budget.isCapped) {
      try {
        const dynamicContext = `${APP_SYSTEM_CONTEXT}

${liveDataSnapshot ? `${liveDataSnapshot}\n` : ''}Current User Session Context:
- Active Page Route: ${currentPath}
- User Role: ${userRole}
${userName ? `- User Name: ${userName}` : ''}
${userEmail ? `- User Email: ${userEmail}` : ''}

IMPORTANT INSTRUCTION FOR DATA QUESTIONS:
When the user asks about specific numbers, budgets (e.g., "what is the budget for Sept from AWS"), monthly spend, top services, unbudgeted accounts, or request approvals, ALWAYS answer using the exact figures provided in "LIVE CLOUD SPEND, BUDGETS & GOVERNANCE DATA" and "LIVE AWS ACCOUNT REQUESTS" above.`;

        const sanitizedHistory: ChatMessage[] = Array.isArray(history)
          ? history
              .slice(-8)
              .filter(
                (m: any) =>
                  m &&
                  (m.role === 'user' || m.role === 'assistant') &&
                  typeof m.content === 'string'
              )
              .map((m: any) => ({
                role: m.role,
                content: m.content,
              }))
          : [];

        const messages: ChatMessage[] = [
          { role: 'system', content: dynamicContext },
          ...sanitizedHistory,
          { role: 'user', content: trimmedMessage },
        ];

        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        };

        if (cfg.provider === 'azure-openai') {
          headers['api-key'] = cfg.apiKey;
        } else {
          headers['Authorization'] = `Bearer ${cfg.apiKey}`;
        }

        const bodyPayload: Record<string, any> = {
          messages,
          temperature: 0.2,
          max_tokens: 900,
        };

        if (cfg.provider !== 'azure-openai' && cfg.model) {
          bodyPayload.model = cfg.model;
        }

        const response = await fetch(cfg.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(bodyPayload),
        });

        if (response.ok) {
          const data: any = await response.json();
          const aiReply = data?.choices?.[0]?.message?.content?.trim();

          // Record exact token cost against the $10 monthly cap
          const promptTokens = Number(data?.usage?.prompt_tokens || 1800);
          const completionTokens = Number(
            data?.usage?.completion_tokens || 250
          );
          recordTokenSpend(
            cfg.model || 'gpt-4o',
            promptTokens,
            completionTokens
          );

          if (aiReply) {
            return res.json({
              reply: aiReply,
              provider: cfg.provider,
              deployment: cfg.model,
              budget: getSpendBudgetStatus(),
            });
          }
        } else {
          const errText = await response.text();
          console.warn(
            `⚠️ [${cfg.label}] Returned HTTP ${response.status}: ${errText}. Falling back to local knowledge base.`
          );
        }
      } catch (llmErr: any) {
        console.warn(
          `⚠️ [${cfg.label}] Request error, using smart fallback:`,
          llmErr.message
        );
      }
    } else if (budget.isCapped) {
      console.warn(
        `🛑 [AI Spend Cap] Monthly limit of $${budget.capUsd} reached ($${budget.spentUsd} used). Serving from free local knowledge base.`
      );
    }

    // Hybrid Fallback: If user asks about live spend/budgets even without an LLM call, surface the live SQL snapshot!
    const qLower = trimmedMessage.toLowerCase();
    const isDataQuery =
      liveDataSnapshot &&
      (qLower.includes('spend') ||
        qLower.includes('cost') ||
        qLower.includes('budget') ||
        qLower.includes('sept') ||
        qLower.includes('aug') ||
        qLower.includes('oct') ||
        qLower.includes('2026') ||
        qLower.includes('how much') ||
        qLower.includes('top service') ||
        qLower.includes('unbudgeted'));

    if (isDataQuery) {
      return res.json({
        reply: `Here is the **live data directly from your SQL Server database**:\n\n${liveDataSnapshot}`,
        provider: 'smart-knowledge-base',
        budget: getSpendBudgetStatus(),
      });
    }

    const fallbackReply = getSmartFallbackReply(
      trimmedMessage,
      currentPath,
      userRole
    );

    return res.json({
      reply: fallbackReply,
      provider: 'smart-knowledge-base',
      budget: getSpendBudgetStatus(),
    });
  } catch (err: any) {
    console.error('❌ [Chat Route Error]:', err);
    return res.status(500).json({
      error: 'Failed to process chat message',
      reply:
        'Sorry, I encountered an unexpected issue. Please try asking your question again.',
    });
  }
});

export default router;
