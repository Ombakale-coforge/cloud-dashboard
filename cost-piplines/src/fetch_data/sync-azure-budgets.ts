/**
 * src/fetch_data/sync-azure-budgets.ts
 *
 * Rate-limit-safe Azure ARM Budgets synchronizer with permission detection.
 * Fetches management-configured budgets from Azure Consumption API and caches them in SQL Server.
 */

import { DefaultAzureCredential } from '@azure/identity';
import { getPrismaClient, disconnectDb } from '../azure_cost_report/db.ts';
import { ensureAlertTablesExist } from '../server/db-alert-tables.ts';

const ARM_API_VERSION = '2023-05-01';
const DELAY_BETWEEN_CALLS_MS = 250;

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BudgetSyncResult {
    totalSubscriptions: number;
    budgetedCount: number;
    unbudgetedCount: number;
    permissionDeniedCount: number;
    errorCount: number;
}

export async function syncAzureBudgets(options: { dryRun?: boolean } = {}): Promise<BudgetSyncResult> {
    const prisma = getPrismaClient();
    await ensureAlertTablesExist(prisma);

    const result: BudgetSyncResult = {
        totalSubscriptions: 0,
        budgetedCount: 0,
        unbudgetedCount: 0,
        permissionDeniedCount: 0,
        errorCount: 0,
    };

    console.log('[Azure Budget Sync] Starting rate-limit-safe Azure Budgets synchronization...');

    // 1. Fetch active subscriptions from existing FOCUS usage records
    const subRecords = await prisma.azureUsageRecord.findMany({
        select: { subscriptionId: true, subscriptionName: true },
        distinct: ['subscriptionId'],
    });

    const subscriptions = subRecords.filter((s) => s.subscriptionId && s.subscriptionId !== 'unknown');
    result.totalSubscriptions = subscriptions.length;

    if (subscriptions.length === 0) {
        console.log('[Azure Budget Sync] No active subscriptions found in azure_usage_records.');
        return result;
    }

    console.log(`[Azure Budget Sync] Found ${subscriptions.length} active subscriptions to check.`);

    if (options.dryRun) {
        console.log('[Azure Budget Sync] Dry-run mode enabled; skipping external ARM API calls.');
        return result;
    }

    // 2. Obtain ARM access token using DefaultAzureCredential
    let token: string | null = null;
    try {
        const credential = new DefaultAzureCredential();
        const tokenResponse = await credential.getToken('https://management.azure.com/.default');
        token = tokenResponse.token;
    } catch (err: any) {
        console.warn(`[Azure Budget Sync] Could not acquire Azure token: ${err.message}`);
        console.warn('[Azure Budget Sync] Marking subscriptions as PERMISSION_DENIED due to missing Azure credentials.');
        
        for (const sub of subscriptions) {
            await prisma.azureSubscriptionBudget.upsert({
                where: {
                    subscriptionId_budgetName: {
                        subscriptionId: sub.subscriptionId,
                        budgetName: '_PERMISSION_DENIED_',
                    },
                },
                update: {
                    subscriptionName: sub.subscriptionName,
                    status: 'PERMISSION_DENIED',
                    errorMessage: `Credential authentication failed: ${err.message.slice(0, 500)}`,
                    lastSyncedAt: new Date(),
                },
                create: {
                    subscriptionId: sub.subscriptionId,
                    subscriptionName: sub.subscriptionName,
                    budgetName: '_PERMISSION_DENIED_',
                    status: 'PERMISSION_DENIED',
                    errorMessage: `Credential authentication failed: ${err.message.slice(0, 500)}`,
                },
            });
            result.permissionDeniedCount += 1;
        }
        return result;
    }

    // 3. Sequentially query each subscription with controlled pacing & 429 retry
    for (const sub of subscriptions) {
        const cleanSubId = sub.subscriptionId.replace(/^\/?subscriptions\//i, '').trim();
        const url = `https://management.azure.com/subscriptions/${cleanSubId}/providers/Microsoft.Consumption/budgets?api-version=${ARM_API_VERSION}`;
        
        try {
            let res: Response | null = null;
            let retries = 3;
            
            while (retries > 0) {
                res = await fetch(url, {
                    headers: {
                        Authorization: `Bearer ${token}`,
                        'Content-Type': 'application/json',
                    },
                });

                if (res.status === 429) {
                    const retryAfter = parseInt(res.headers.get('Retry-After') || '5', 10);
                    console.warn(`[Azure Budget Sync] 429 Throttled on subscription ${sub.subscriptionId}. Waiting ${retryAfter}s...`);
                    await sleep(retryAfter * 1000);
                    retries--;
                    continue;
                }
                break;
            }

            if (!res) throw new Error('No HTTP response received');

            // Handle 403 Forbidden / Permission Denied
            if (res.status === 403) {
                const errBody = await res.text().catch(() => '');
                console.warn(`[Azure Budget Sync] 🔒 Permission Denied (403) on subscription ${sub.subscriptionId}`);
                await prisma.azureSubscriptionBudget.upsert({
                    where: {
                        subscriptionId_budgetName: {
                            subscriptionId: sub.subscriptionId,
                            budgetName: '_PERMISSION_DENIED_',
                        },
                    },
                    update: {
                        subscriptionName: sub.subscriptionName,
                        status: 'PERMISSION_DENIED',
                        errorMessage: `Azure 403 Forbidden: Caller lacks Cost Management Reader permission. ${errBody.slice(0, 250)}`,
                        lastSyncedAt: new Date(),
                    },
                    create: {
                        subscriptionId: sub.subscriptionId,
                        subscriptionName: sub.subscriptionName,
                        budgetName: '_PERMISSION_DENIED_',
                        status: 'PERMISSION_DENIED',
                        errorMessage: `Azure 403 Forbidden: Caller lacks Cost Management Reader permission. ${errBody.slice(0, 250)}`,
                    },
                });
                result.permissionDeniedCount++;
                await sleep(DELAY_BETWEEN_CALLS_MS);
                continue;
            }

            if (!res.ok) {
                const errText = await res.text().catch(() => '');
                console.warn(`[Azure Budget Sync] ⚠️ HTTP ${res.status} on subscription ${sub.subscriptionId}: ${errText.slice(0, 150)}`);
                await prisma.azureSubscriptionBudget.upsert({
                    where: {
                        subscriptionId_budgetName: {
                            subscriptionId: sub.subscriptionId,
                            budgetName: '_ERROR_',
                        },
                    },
                    update: {
                        subscriptionName: sub.subscriptionName,
                        status: 'ERROR',
                        errorMessage: `HTTP ${res.status}: ${errText.slice(0, 500)}`,
                        lastSyncedAt: new Date(),
                    },
                    create: {
                        subscriptionId: sub.subscriptionId,
                        subscriptionName: sub.subscriptionName,
                        budgetName: '_ERROR_',
                        status: 'ERROR',
                        errorMessage: `HTTP ${res.status}: ${errText.slice(0, 500)}`,
                    },
                });
                result.errorCount++;
                await sleep(DELAY_BETWEEN_CALLS_MS);
                continue;
            }

            const data = await res.json();
            const budgets = data?.value || [];

            if (budgets.length === 0) {
                // Subscription is accessible, but management has not configured a budget
                await prisma.azureSubscriptionBudget.upsert({
                    where: {
                        subscriptionId_budgetName: {
                            subscriptionId: sub.subscriptionId,
                            budgetName: '_UNBUDGETED_',
                        },
                    },
                    update: {
                        subscriptionName: sub.subscriptionName,
                        status: 'UNBUDGETED',
                        amount: null,
                        errorMessage: null,
                        lastSyncedAt: new Date(),
                    },
                    create: {
                        subscriptionId: sub.subscriptionId,
                        subscriptionName: sub.subscriptionName,
                        budgetName: '_UNBUDGETED_',
                        status: 'UNBUDGETED',
                    },
                });
                result.unbudgetedCount++;
            } else {
                // Budgets found: record each budget
                for (const b of budgets) {
                    const props = b.properties || {};
                    const notifications = Object.values(props.notifications || {}).map((n: any) => n.threshold).filter(Boolean);
                    const contactEmails = Object.values(props.notifications || {}).flatMap((n: any) => n.contactEmails || []).filter(Boolean);

                    await prisma.azureSubscriptionBudget.upsert({
                        where: {
                            subscriptionId_budgetName: {
                                subscriptionId: sub.subscriptionId,
                                budgetName: b.name,
                            },
                        },
                        update: {
                            subscriptionName: sub.subscriptionName,
                            amount: props.amount !== undefined ? String(props.amount) : null,
                            timeGrain: props.timeGrain || 'Monthly',
                            startDate: props.timePeriod?.startDate ? new Date(props.timePeriod.startDate) : null,
                            endDate: props.timePeriod?.endDate ? new Date(props.timePeriod.endDate) : null,
                            thresholds: notifications.length ? JSON.stringify(notifications) : null,
                            contactEmails: contactEmails.length ? JSON.stringify(contactEmails) : null,
                            status: 'BUDGETED',
                            errorMessage: null,
                            lastSyncedAt: new Date(),
                        },
                        create: {
                            subscriptionId: sub.subscriptionId,
                            subscriptionName: sub.subscriptionName,
                            budgetName: b.name,
                            amount: props.amount !== undefined ? String(props.amount) : null,
                            timeGrain: props.timeGrain || 'Monthly',
                            startDate: props.timePeriod?.startDate ? new Date(props.timePeriod.startDate) : null,
                            endDate: props.timePeriod?.endDate ? new Date(props.timePeriod.endDate) : null,
                            thresholds: notifications.length ? JSON.stringify(notifications) : null,
                            contactEmails: contactEmails.length ? JSON.stringify(contactEmails) : null,
                            status: 'BUDGETED',
                        },
                    });
                }
                result.budgetedCount++;
                console.log(`[Azure Budget Sync] ✓ Synced ${budgets.length} budget(s) for ${sub.subscriptionName || sub.subscriptionId}`);
            }

            await sleep(DELAY_BETWEEN_CALLS_MS);
        } catch (subErr: any) {
            console.error(`[Azure Budget Sync] Error querying subscription ${sub.subscriptionId}:`, subErr.message);
            result.errorCount++;
        }
    }

    console.log('[Azure Budget Sync] Synchronization completed:', result);
    return result;
}

// Runnable CLI entrypoint
if (process.argv[1]?.endsWith('sync-azure-budgets.ts')) {
    const isDryRun = process.argv.includes('--dry-run');
    syncAzureBudgets({ dryRun: isDryRun })
        .then(() => disconnectDb())
        .catch((e) => {
            console.error('[Azure Budget Sync] Fatal failure:', e);
            disconnectDb().finally(() => process.exit(1));
        });
}
