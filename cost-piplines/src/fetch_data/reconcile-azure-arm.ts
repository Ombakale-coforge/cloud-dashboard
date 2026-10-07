import { ClientSecretCredential } from '@azure/identity';
import { SubscriptionClient } from '@azure/arm-subscriptions';
import { CostManagementClient } from '@azure/arm-costmanagement';
import { getPrismaClient, disconnectDb } from '../azure_cost_report/db';
import 'dotenv/config';

interface ReconcileOptions {
    month: string;
    top: number;
    subId?: string;
    checkAll: boolean;
}

function parseCliArgs(): ReconcileOptions {
    const args = process.argv.slice(2);
    let month = '2026-09';
    let top = 10;
    let subId: string | undefined;
    let checkAll = false;

    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--month' && args[i + 1]) {
            month = args[++i];
        } else if (args[i] === '--top' && args[i + 1]) {
            top = Number.parseInt(args[++i], 10) || 10;
        } else if (args[i] === '--sub' && args[i + 1]) {
            subId = args[++i].replace('/subscriptions/', '').toLowerCase();
        } else if (args[i] === '--all') {
            checkAll = true;
        }
    }

    return { month, top, subId, checkAll };
}

function getMonthDateRange(monthStr: string): { from: Date; to: Date } {
    const [year, month] = monthStr.split('-').map(Number);
    const from = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0));
    const lastDay = new Date(Date.UTC(year, month, 0, 23, 59, 59));
    return { from, to: lastDay };
}

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 4, delayMs = 2000): Promise<T> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (err: any) {
            const isThrottled = err.statusCode === 429 || err.message?.includes('Too many requests');
            if (isThrottled && attempt < maxRetries) {
                const wait = delayMs * attempt;
                process.stdout.write(` [429 throttled, waiting ${wait / 1000}s...]`);
                await new Promise((r) => setTimeout(r, wait));
                continue;
            }
            throw err;
        }
    }
    throw new Error('Exceeded retry attempts');
}

export async function runDeduplicationAudit(prisma = getPrismaClient()) {
    console.log('\n======================================================');
    console.log('1. DATABASE DEDUPLICATION & INTEGRITY AUDIT');
    console.log('======================================================');

    const totalRecords = await prisma.azureUsageRecord.count();
    console.log(`Total usage records in DB: ${totalRecords.toLocaleString()}`);

    // Check 1: Duplicate stable_row_hash (identical row duplicates)
    const dupStableRes: any = await prisma.$queryRawUnsafe(`
        SELECT COUNT(*) as dup_count 
        FROM (
            SELECT stable_row_hash 
            FROM azure_usage_records 
            GROUP BY stable_row_hash 
            HAVING COUNT(*) > 1
        ) t
    `);
    const dupStableCount = Number(dupStableRes[0]?.dup_count ?? 0);
    console.log(`- Exact duplicate rows (stable_row_hash collisions): ${dupStableCount}`);
    if (dupStableCount === 0) {
        console.log('  ✓ PASS: Zero duplicate rows exist in azure_usage_records.');
    } else {
        console.log(`  ⚠ WARNING: Found ${dupStableCount} duplicate rows.`);
    }

    // Check 2: Active runs per period
    const runs = await prisma.azureIngestionRun.findMany({
        orderBy: { id: 'desc' },
        take: 6,
        select: {
            id: true,
            exportPeriod: true,
            exportRunId: true,
            status: true,
            rowsWritten: true,
            duplicatesFlagged: true,
        },
    });
    console.log('\n- Recent Ingestion Runs:');
    for (const r of runs) {
        console.log(`  Run #${r.id} [${r.exportPeriod}]: status=${r.status}, written=${Number(r.rowsWritten).toLocaleString()}, dropped_dups=${Number(r.duplicatesFlagged).toLocaleString()}`);
    }

    return { totalRecords, dupStableCount };
}

export async function runArmReconciliation(options: ReconcileOptions) {
    const { month, top, subId, checkAll } = options;
    const { from, to } = getMonthDateRange(month);

    console.log('\n======================================================');
    console.log(`2. AZURE ARM RECONCILIATION FOR PERIOD: ${month}`);
    console.log(`   Date range: ${from.toISOString().slice(0, 10)} to ${to.toISOString().slice(0, 10)}`);
    console.log('======================================================');

    const credential = new ClientSecretCredential(
        process.env.AZURE_TENANT_ID!,
        process.env.AZURE_CLIENT_ID!,
        process.env.AZURE_CLIENT_SECRET!
    );

    const subClient = new SubscriptionClient(credential);
    const armSubs = new Map<string, string>();
    for await (const s of subClient.subscriptions.list()) {
        if (s.subscriptionId) {
            armSubs.set(s.subscriptionId.toLowerCase(), s.displayName || 'Unnamed');
        }
    }
    console.log(`Azure ARM accessible subscriptions: ${armSubs.size}`);

    const prisma = getPrismaClient();

    // Query top spend subscriptions in DB for target month
    let queryFilter = `WHERE usage_month = '${month}'`;
    if (subId) {
        queryFilter += ` AND (subscription_id LIKE '%${subId}%')`;
    }

    const dbSubs: any = await prisma.$queryRawUnsafe(`
        SELECT 
            subscription_id,
            subscription_name,
            COUNT(*) as row_count,
            SUM(effective_cost) as total_effective,
            SUM(billed_cost) as total_billed
        FROM azure_usage_records
        ${queryFilter}
        GROUP BY subscription_id, subscription_name
        ORDER BY total_effective DESC
    `);

    if (!dbSubs.length) {
        console.log(`No usage records found in DB for month ${month}.`);
        return;
    }

    const costClient = new CostManagementClient(credential);
    const matchedSubs = dbSubs
        .map((row: any) => {
            const rawId = (row.subscription_id || '').toLowerCase();
            const cleanId = rawId.replace('/subscriptions/', '');
            return {
                cleanId,
                nameInDb: row.subscription_name || armSubs.get(cleanId) || cleanId,
                totalEffective: Number(row.total_effective ?? 0),
                totalBilled: Number(row.total_billed ?? 0),
                rowCount: Number(row.row_count ?? 0),
                isArmAccessible: armSubs.has(cleanId),
            };
        })
        .filter((s: any) => s.isArmAccessible);

    const candidates = checkAll || subId ? matchedSubs : matchedSubs.slice(0, top);

    console.log(`\nReconciling ${candidates.length} subscription(s) against Azure ARM...`);

    const results: Array<{
        subscription: string;
        subId: string;
        armCost: number;
        dbBilled: number;
        dbEffective: number;
        delta: number;
        variancePct: number;
        status: string;
    }> = [];

    for (const c of candidates) {
        process.stdout.write(`Fetching ARM cost for ${c.nameInDb} (${c.cleanId.slice(0, 8)}...)...`);
        const scope = `/subscriptions/${c.cleanId}`;

        try {
            // Ponytail: single delay between calls to respect rate limit
            await new Promise((r) => setTimeout(r, 600));

            const armRes = await withRetry(() =>
                costClient.query.usage(scope, {
                    type: 'ActualCost',
                    timeframe: 'Custom',
                    timePeriod: { from, to },
                    dataset: {
                        granularity: 'None',
                        aggregation: {
                            totalCost: { name: 'Cost', function: 'Sum' },
                        },
                    },
                })
            );

            const armCost = Number(armRes.rows?.[0]?.[0] ?? 0);
            const delta = c.totalBilled - armCost;
            const variancePct = armCost > 0 ? Math.abs((delta / armCost) * 100) : 0;
            const status = variancePct < 0.05 ? 'MATCH' : variancePct < 1.0 ? 'WARN (<1%)' : 'DIFF';

            results.push({
                subscription: c.nameInDb.slice(0, 28),
                subId: c.cleanId,
                armCost: Number(armCost.toFixed(2)),
                dbBilled: Number(c.totalBilled.toFixed(2)),
                dbEffective: Number(c.totalEffective.toFixed(2)),
                delta: Number(delta.toFixed(2)),
                variancePct: Number(variancePct.toFixed(4)),
                status,
            });

            console.log(` Done: ARM=₹${armCost.toFixed(2)} | DB=₹${c.totalBilled.toFixed(2)} [${status}]`);
        } catch (err: any) {
            console.log(` Error: ${err.message?.split('\n')[0]}`);
        }
    }

    console.log('\n========================================================================================================');
    console.log(`RECONCILIATION SUMMARY TABLE (${month})`);
    console.log('========================================================================================================');
    console.table(
        results.map((r) => ({
            'Subscription Name': r.subscription,
            'ARM ActualCost': `₹${r.armCost.toLocaleString()}`,
            'DB Billed': `₹${r.dbBilled.toLocaleString()}`,
            'DB Effective': `₹${r.dbEffective.toLocaleString()}`,
            'Delta (DB-ARM)': `₹${r.delta.toLocaleString()}`,
            'Variance %': `${r.variancePct}%`,
            Status: r.status,
        }))
    );

    const matches = results.filter((r) => r.status === 'MATCH').length;
    console.log(`\nReconciliation Results: ${matches}/${results.length} subscriptions matched with < 0.05% variance.`);
}

export async function main() {
    const opts = parseCliArgs();
    try {
        await runDeduplicationAudit();
        await runArmReconciliation(opts);
    } finally {
        await disconnectDb();
    }
}

if (process.argv[1] && process.argv[1].endsWith('reconcile-azure-arm.ts')) {
    main().catch((err) => {
        console.error('Reconciliation failed:', err);
        process.exit(1);
    });
}
