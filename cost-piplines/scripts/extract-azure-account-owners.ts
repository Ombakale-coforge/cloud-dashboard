import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse';
import {
    AZURE_TENANT_ID,
    AZURE_CLIENT_ID,
    AZURE_CLIENT_SECRET,
    AZURE_STORAGE_ACCOUNT_NAME,
    AZURE_STORAGE_CONTAINER_NAME,
    exportPrefix,
} from '../src/fetch_data/focus-export/config.ts';
import {
    discoverLatestRunsPerPeriod,
    getBlobReadStream,
    getContainerClient,
    getManifestCsvBlobNames,
} from '../src/fetch_data/focus-export/azure-storage.ts';
import { parseTags } from '../src/fetch_data/focus-export/transform.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const OWNER_TAG_KEY_PATTERN = /(owner|created[\s_-]*by|contact|poc|spoc|manager|lead|team|maintainer|email|author|request(?:or|er))/i;

interface AccountAccumulator {
    subscriptionId: string;
    subscriptionName: string;
    accountOwnerIds: Set<string>;
    accountNames: Set<string>;
    billingAccounts: Set<string>;
    costCenters: Set<string>;
    invoiceSections: Set<string>;
    ownerTags: Map<string, Set<string>>;
    tagKeys: Set<string>;
    records: number;
    totalEffectiveCost: number;
}

export interface AccountOwnerSummary {
    subscriptionId: string;
    subscriptionName: string;
    owner: string | null;
    accountOwnerIds: string[];
    accountNames: string[];
    billingAccounts: string[];
    costCenters: string[];
    invoiceSections: string[];
    ownerTags: Record<string, string[]>;
    tagKeys: string[];
    records: number;
    totalEffectiveCost: number;
}

function clean(val: unknown): string {
    return typeof val === 'string' ? val.trim() : val == null ? '' : String(val).trim();
}

export function accumulateRow(
    accounts: Map<string, AccountAccumulator>,
    allTagKeys: Set<string>,
    row: Record<string, unknown>
): void {
    const subId = clean(row.SubAccountId || row.SubscriptionId || row.x_SubscriptionId || row.subscriptionId);
    const subName = clean(row.SubAccountName || row.SubscriptionName || row.x_SubscriptionName || row.subscriptionName);
    const key = subId || subName || 'unknown-subscription';

    let acc = accounts.get(key);
    if (!acc) {
        acc = {
            subscriptionId: subId || 'N/A',
            subscriptionName: subName || 'N/A',
            accountOwnerIds: new Set(),
            accountNames: new Set(),
            billingAccounts: new Set(),
            costCenters: new Set(),
            invoiceSections: new Set(),
            ownerTags: new Map(),
            tagKeys: new Set(),
            records: 0,
            totalEffectiveCost: 0,
        };
        accounts.set(key, acc);
    }

    if (acc.subscriptionId === 'N/A' && subId) acc.subscriptionId = subId;
    if (acc.subscriptionName === 'N/A' && subName) acc.subscriptionName = subName;

    const ownerId = clean(row.x_AccountOwnerId || row.accountOwnerId);
    const accountName = clean(row.x_AccountName || row.accountName);
    const billingAccount = clean(row.BillingAccountName || row.x_BillingAccountName || row.BillingAccountId);
    const costCenter = clean(row.x_CostCenter || row.costCenter);
    const invoiceSection = clean(row.x_InvoiceSectionName || row.invoiceSection);

    if (ownerId) acc.accountOwnerIds.add(ownerId);
    if (accountName) acc.accountNames.add(accountName);
    if (billingAccount) acc.billingAccounts.add(billingAccount);
    if (costCenter) acc.costCenters.add(costCenter);
    if (invoiceSection) acc.invoiceSections.add(invoiceSection);

    const { tagsJson } = parseTags(row.Tags);
    if (tagsJson) {
        const parsed = JSON.parse(tagsJson) as Record<string, unknown>;
        for (const [rawK, rawV] of Object.entries(parsed)) {
            const k = clean(rawK);
            const v = clean(rawV);
            if (!k) continue;
            acc.tagKeys.add(k);
            allTagKeys.add(k);
            if (v && OWNER_TAG_KEY_PATTERN.test(k)) {
                let vals = acc.ownerTags.get(k);
                if (!vals) {
                    vals = new Set();
                    acc.ownerTags.set(k, vals);
                }
                vals.add(v);
            }
        }
    }

    const cost = Number.parseFloat(clean(row.EffectiveCost || row.BilledCost || row.Cost || '0'));
    if (Number.isFinite(cost)) acc.totalEffectiveCost += cost;
    acc.records++;
}

export function finalizeAccounts(accounts: Map<string, AccountAccumulator>): AccountOwnerSummary[] {
    return [...accounts.values()]
        .map((acc) => {
            const accountOwnerIds = [...acc.accountOwnerIds].sort();
            const accountNames = [...acc.accountNames].sort();
            const ownerTags: Record<string, string[]> = {};
            for (const k of [...acc.ownerTags.keys()].sort()) {
                ownerTags[k] = [...acc.ownerTags.get(k)!].sort();
            }
            const firstTagOwner = Object.values(ownerTags)[0]?.[0] ?? null;
            return {
                subscriptionId: acc.subscriptionId,
                subscriptionName: acc.subscriptionName,
                owner: accountOwnerIds[0] || accountNames[0] || firstTagOwner,
                accountOwnerIds,
                accountNames,
                billingAccounts: [...acc.billingAccounts].sort(),
                costCenters: [...acc.costCenters].sort(),
                invoiceSections: [...acc.invoiceSections].sort(),
                ownerTags,
                tagKeys: [...acc.tagKeys].sort(),
                records: acc.records,
                totalEffectiveCost: Number(acc.totalEffectiveCost.toFixed(2)),
            };
        })
        .sort((a, b) => a.subscriptionName.localeCompare(b.subscriptionName, undefined, { sensitivity: 'base' }));
}

const DEFAULT_OUT_FILE = 'azure_account_owners.json';

export function resolveOutputPath(args: string[]): string {
    const outIdx = args.indexOf('--out');
    const rawOut = outIdx !== -1 && args[outIdx + 1] && !args[outIdx + 1].startsWith('--') ? args[outIdx + 1] : null;
    if (!rawOut) return path.join(__dirname, DEFAULT_OUT_FILE);

    const resolved = path.resolve(process.cwd(), rawOut);
    if (rawOut.endsWith('/') || rawOut.endsWith(path.sep) || (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory())) {
        return path.join(resolved, DEFAULT_OUT_FILE);
    }
    return resolved;
}

function runSelfCheck(): void {
    const accounts = new Map<string, AccountAccumulator>();
    const allTagKeys = new Set<string>();

    accumulateRow(accounts, allTagKeys, {
        SubAccountId: '/subscriptions/sub-1',
        SubAccountName: 'Alpha Sub',
        x_AccountOwnerId: 'alice@example.com',
        x_AccountName: 'Alice Smith',
        x_CostCenter: 'CC-100',
        x_InvoiceSectionName: 'Engineering',
        BillingAccountName: 'Corp',
        EffectiveCost: '10.50',
        Tags: '{"Owner":"bob@example.com","Environment":"Prod"}',
    });
    accumulateRow(accounts, allTagKeys, {
        SubAccountId: '/subscriptions/sub-1',
        SubAccountName: 'Alpha Sub',
        x_AccountOwnerId: 'alice@example.com',
        EffectiveCost: '4.50',
        Tags: 'CreatedBy:charlie@example.com;App:Billing',
    });
    accumulateRow(accounts, allTagKeys, {
        SubAccountId: '/subscriptions/sub-2',
        SubAccountName: 'Beta Sub',
        EffectiveCost: '2.00',
        Tags: '{"SPOC":"dana@example.com"}',
    });

    const result = finalizeAccounts(accounts);
    assert.equal(result.length, 2);
    assert.equal(result[0].owner, 'alice@example.com');
    assert.deepEqual(result[0].ownerTags, {
        CreatedBy: ['charlie@example.com'],
        Owner: ['bob@example.com'],
    });
    assert.equal(result[0].totalEffectiveCost, 15);
    assert.equal(result[1].owner, 'dana@example.com');
    assert.deepEqual([...allTagKeys].sort(), ['App', 'CreatedBy', 'Environment', 'Owner', 'SPOC']);
    assert.equal(resolveOutputPath(['--out', '.']), path.join(process.cwd(), DEFAULT_OUT_FILE));
    assert.equal(resolveOutputPath(['--out', 'out.json']), path.resolve(process.cwd(), 'out.json'));
    console.log('Self-check passed.');
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.includes('--self-check')) {
        runSelfCheck();
        return;
    }

    const scanAll = args.includes('--all');
    const outputPath = resolveOutputPath(args);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET || !AZURE_STORAGE_ACCOUNT_NAME || !AZURE_STORAGE_CONTAINER_NAME) {
        throw new Error('Missing required Azure Storage env vars (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_STORAGE_ACCOUNT_NAME, AZURE_STORAGE_CONTAINER_NAME).');
    }

    const containerClient = getContainerClient();
    console.log(`Output file: ${outputPath}`);
    console.log(`Listing FOCUS exports under ${AZURE_STORAGE_ACCOUNT_NAME}/${AZURE_STORAGE_CONTAINER_NAME}/${exportPrefix}...`);

    const allRuns = await discoverLatestRunsPerPeriod(containerClient);
    if (allRuns.length === 0) {
        throw new Error(`No FOCUS export periods found under prefix: ${exportPrefix}`);
    }

    const runsToScan = scanAll ? allRuns : [allRuns[allRuns.length - 1]];
    console.log(`Scanning ${runsToScan.length} period(s): ${runsToScan.map((r) => r.exportPeriod).join(', ')}`);

    const accounts = new Map<string, AccountAccumulator>();
    const allTagKeys = new Set<string>();
    let totalRowsProcessed = 0;

    for (const run of runsToScan) {
        const manifestBlob = run.blobs.find((b) => b.name.endsWith('manifest.json'));
        let csvBlobs: string[] | null = null;
        if (manifestBlob) {
            const manifestList = await getManifestCsvBlobNames(manifestBlob.name, containerClient);
            if (manifestList && manifestList.length > 0) {
                const dir = path.posix.dirname(manifestBlob.name);
                csvBlobs = manifestList.map((name) => (name.includes('/') ? name : `${dir}/${name}`));
            }
        }
        if (!csvBlobs || csvBlobs.length === 0) {
            csvBlobs = run.blobs
                .filter((b) => b.name.endsWith('.csv.gz') || b.name.endsWith('.csv'))
                .map((b) => b.name);
        }

        for (const [i, blobName] of csvBlobs.entries()) {
            process.stdout.write(`  [${run.exportPeriod} ${i + 1}/${csvBlobs.length}] ${path.basename(blobName)}... `);
            const stream = await getBlobReadStream(blobName, containerClient);
            const parser = stream.pipe(parse({ columns: true, skip_empty_lines: true, bom: true, relax_column_count: true }));

            let rows = 0;
            for await (const row of parser) {
                accumulateRow(accounts, allTagKeys, row);
                rows++;
                totalRowsProcessed++;
            }
            console.log(`${rows.toLocaleString()} rows`);
        }
    }

    const summary = finalizeAccounts(accounts);
    const payload = {
        generatedAt: new Date().toISOString(),
        periodsScanned: runsToScan.map((r) => r.exportPeriod),
        totalRowsProcessed,
        totalAccounts: summary.length,
        accountsWithBillingOwner: summary.filter((a) => a.accountOwnerIds.length > 0 || a.accountNames.length > 0).length,
        accountsWithOwnerTag: summary.filter((a) => Object.keys(a.ownerTags).length > 0).length,
        allDistinctTagKeys: [...allTagKeys].sort(),
        accounts: summary,
    };

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\nWrote ${summary.length} account(s) to ${outputPath}`);
    console.log(`  Billing owner populated: ${payload.accountsWithBillingOwner}/${summary.length}`);
    console.log(`  Owner-like tag populated: ${payload.accountsWithOwnerTag}/${summary.length}`);
    console.log(`  Distinct tag keys found: ${payload.allDistinctTagKeys.length}`);
}

main().catch((err) => {
    console.error('Failed to extract Azure account owners:', err.message || err);
    process.exit(1);
});
