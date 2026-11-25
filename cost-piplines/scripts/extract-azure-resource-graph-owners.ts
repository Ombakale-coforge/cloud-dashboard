import 'dotenv/config';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClientSecretCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DEFAULT_OUT_FILE = 'azure_resource_graph_owners.json';
const OWNER_ROLE_DEF_GUID = '8e3af657-a8ff-443c-a75c-2fe8c4bcb635';
const OWNER_TAG_KEY_PATTERN =
    /(owner|created[\s_-]*by|creator|managed[\s_-]*by|contact|poc|spoc|manager|lead|team|maintainer|email|author|request(?:or|er))/i;

export interface PrincipalInfo {
    principalId: string;
    principalType: string | null;
    displayName?: string | null;
    emailOrUpn?: string | null;
}

interface RawSubRow {
    subscriptionId: string;
    name: string;
    state?: string;
    tags?: Record<string, unknown> | null;
}

interface RawRgRow {
    name: string;
    subscriptionId: string;
    location?: string;
    tags?: Record<string, unknown> | null;
}

interface RawRbacRow {
    subscriptionId: string;
    scope: string;
    principalId: string;
    principalType?: string;
}

function clean(val: unknown): string {
    return typeof val === 'string' ? val.trim() : val == null ? '' : String(val).trim();
}

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

export function extractOwnerTags(
    tags: Record<string, unknown> | null | undefined,
    keyCollector?: Set<string>
): Record<string, string> {
    const out: Record<string, string> = {};
    if (!tags || typeof tags !== 'object') return out;
    for (const [rawK, rawV] of Object.entries(tags)) {
        const k = clean(rawK);
        const v = clean(rawV);
        if (!k) continue;
        keyCollector?.add(k);
        if (v && OWNER_TAG_KEY_PATTERN.test(k)) {
            out[k] = v;
        }
    }
    return out;
}

export function classifyScope(scope: string): {
    kind: 'subscription' | 'resourceGroup' | 'resource' | 'other';
    resourceGroup?: string;
} {
    const normalized = scope.trim().replace(/\/+$/, '');
    if (/^\/subscriptions\/[^/]+$/i.test(normalized)) {
        return { kind: 'subscription' };
    }
    const rgExact = normalized.match(/^\/subscriptions\/[^/]+\/resourceGroups\/([^/]+)$/i);
    if (rgExact) {
        return { kind: 'resourceGroup', resourceGroup: rgExact[1] };
    }
    const rgChild = normalized.match(/^\/subscriptions\/[^/]+\/resourceGroups\/([^/]+)\/.+$/i);
    if (rgChild) {
        return { kind: 'resource', resourceGroup: rgChild[1] };
    }
    return { kind: 'other' };
}

async function queryAllPages<T>(client: ResourceGraphClient, query: string): Promise<T[]> {
    const rows: T[] = [];
    let skipToken: string | undefined;

    do {
        const res = await client.resources({
            query,
            options: {
                resultFormat: 'objectArray',
                top: 1000,
                ...(skipToken ? { skipToken } : {}),
            },
        });
        if (Array.isArray(res.data)) {
            rows.push(...(res.data as T[]));
        }
        skipToken = res.skipToken || undefined;
    } while (skipToken);

    return rows;
}

async function resolvePrincipalsViaGraph(
    credential: ClientSecretCredential,
    principalIds: string[]
): Promise<{ resolved: Map<string, { displayName: string | null; emailOrUpn: string | null }>; error: string | null }> {
    const resolved = new Map<string, { displayName: string | null; emailOrUpn: string | null }>();
    if (principalIds.length === 0) return { resolved, error: null };

    try {
        const token = await credential.getToken('https://graph.microsoft.com/.default');
        if (!token?.token) {
            return { resolved, error: 'Could not acquire Microsoft Graph token' };
        }

        // Microsoft Graph directoryObjects/getByIds accepts up to 1,000 IDs per request
        for (let i = 0; i < principalIds.length; i += 1000) {
            const batch = principalIds.slice(i, i + 1000);
            const resp = await fetch('https://graph.microsoft.com/v1.0/directoryObjects/getByIds', {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    ids: batch,
                    types: ['user', 'group', 'servicePrincipal'],
                }),
            });

            if (!resp.ok) {
                const body = await resp.text().catch(() => '');
                return {
                    resolved,
                    error: `Microsoft Graph HTTP ${resp.status}: ${body.slice(0, 200) || resp.statusText}`,
                };
            }

            const data = (await resp.json()) as { value?: Array<Record<string, unknown>> };
            for (const obj of data.value || []) {
                const id = clean(obj.id).toLowerCase();
                if (!id) continue;
                const displayName = clean(obj.displayName) || null;
                const emailOrUpn = clean(obj.mail || obj.userPrincipalName || obj.appId) || null;
                resolved.set(id, { displayName, emailOrUpn });
            }
        }

        return { resolved, error: null };
    } catch (err: any) {
        return { resolved, error: err?.message || String(err) };
    }
}

export function buildReport(
    subs: RawSubRow[],
    rgs: RawRgRow[],
    rbacRows: RawRbacRow[],
    resolvedPrincipals: Map<string, { displayName: string | null; emailOrUpn: string | null }>
) {
    const allSubscriptionTagKeys = new Set<string>();
    const allResourceGroupTagKeys = new Set<string>();

    const subMap = new Map<
        string,
        {
            subscriptionId: string;
            subscriptionName: string;
            state: string | null;
            subscriptionOwnerTags: Record<string, string>;
            subscriptionTags: Record<string, string>;
            totalResourceGroups: number;
            resourceGroupsWithOwnerTags: Array<{
                resourceGroup: string;
                location: string | null;
                ownerTags: Record<string, string>;
            }>;
            rbacOwners: {
                subscriptionScope: PrincipalInfo[];
                resourceGroupScopes: Record<string, PrincipalInfo[]>;
                resourceScopeCount: number;
            };
        }
    >();

    for (const s of subs) {
        const subId = clean(s.subscriptionId).toLowerCase();
        if (!subId) continue;
        const cleanTags: Record<string, string> = {};
        if (s.tags && typeof s.tags === 'object') {
            for (const [k, v] of Object.entries(s.tags)) {
                const ck = clean(k);
                if (ck) cleanTags[ck] = clean(v);
            }
        }
        subMap.set(subId, {
            subscriptionId: subId,
            subscriptionName: clean(s.name) || subId,
            state: clean(s.state) || null,
            subscriptionOwnerTags: extractOwnerTags(s.tags, allSubscriptionTagKeys),
            subscriptionTags: cleanTags,
            totalResourceGroups: 0,
            resourceGroupsWithOwnerTags: [],
            rbacOwners: {
                subscriptionScope: [],
                resourceGroupScopes: {},
                resourceScopeCount: 0,
            },
        });
    }

    for (const rg of rgs) {
        const subId = clean(rg.subscriptionId).toLowerCase();
        const entry = subMap.get(subId);
        if (!entry) continue;
        entry.totalResourceGroups++;
        const ownerTags = extractOwnerTags(rg.tags, allResourceGroupTagKeys);
        if (Object.keys(ownerTags).length > 0) {
            entry.resourceGroupsWithOwnerTags.push({
                resourceGroup: clean(rg.name),
                location: clean(rg.location) || null,
                ownerTags,
            });
        }
    }

    const toPrincipalInfo = (r: RawRbacRow): PrincipalInfo => {
        const pid = clean(r.principalId).toLowerCase();
        const graph = resolvedPrincipals.get(pid);
        return {
            principalId: clean(r.principalId),
            principalType: clean(r.principalType) || null,
            ...(graph ? { displayName: graph.displayName, emailOrUpn: graph.emailOrUpn } : {}),
        };
    };

    for (const r of rbacRows) {
        const subId = clean(r.subscriptionId).toLowerCase();
        const entry = subMap.get(subId);
        if (!entry) continue;
        const scopeInfo = classifyScope(clean(r.scope));
        if (scopeInfo.kind === 'subscription') {
            entry.rbacOwners.subscriptionScope.push(toPrincipalInfo(r));
        } else if (scopeInfo.kind === 'resourceGroup' && scopeInfo.resourceGroup) {
            const list = entry.rbacOwners.resourceGroupScopes[scopeInfo.resourceGroup] || [];
            list.push(toPrincipalInfo(r));
            entry.rbacOwners.resourceGroupScopes[scopeInfo.resourceGroup] = list;
        } else if (scopeInfo.kind === 'resource') {
            entry.rbacOwners.resourceScopeCount++;
        }
    }

    const subscriptions = [...subMap.values()].sort((a, b) =>
        a.subscriptionName.localeCompare(b.subscriptionName, undefined, { sensitivity: 'base' })
    );

    for (const sub of subscriptions) {
        sub.resourceGroupsWithOwnerTags.sort((a, b) => a.resourceGroup.localeCompare(b.resourceGroup));
    }

    return {
        subscriptions,
        allSubscriptionTagKeys: [...allSubscriptionTagKeys].sort(),
        allResourceGroupTagKeys: [...allResourceGroupTagKeys].sort(),
    };
}

function runSelfCheck(): void {
    const subTagKeys = new Set<string>();
    assert.deepEqual(
        extractOwnerTags({ Owner: 'alice@example.com', Env: 'Prod', '   ': 'ignored' }, subTagKeys),
        { Owner: 'alice@example.com' }
    );
    assert.deepEqual([...subTagKeys].sort(), ['Env', 'Owner']);

    assert.deepEqual(classifyScope('/subscriptions/sub-1/'), { kind: 'subscription' });
    assert.deepEqual(classifyScope('/subscriptions/sub-1/resourceGroups/rg-app'), {
        kind: 'resourceGroup',
        resourceGroup: 'rg-app',
    });
    assert.deepEqual(
        classifyScope('/subscriptions/sub-1/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm1'),
        { kind: 'resource', resourceGroup: 'rg-app' }
    );
    assert.deepEqual(classifyScope('/providers/Microsoft.Management/managementGroups/mg-1'), { kind: 'other' });

    const resolved = new Map([['pid-1', { displayName: 'Alice Smith', emailOrUpn: 'alice@example.com' }]]);
    const report = buildReport(
        [{ subscriptionId: 'sub-1', name: 'Alpha', state: 'Enabled', tags: { Owner: 'alice@example.com', Env: 'Prod' } }],
        [
            { subscriptionId: 'sub-1', name: 'rg-app', location: 'eastus', tags: { ManagedBy: 'bob@example.com' } },
            { subscriptionId: 'sub-1', name: 'rg-empty', location: 'eastus', tags: { Env: 'Dev' } },
        ],
        [
            { subscriptionId: 'sub-1', scope: '/subscriptions/sub-1', principalId: 'pid-1', principalType: 'User' },
            {
                subscriptionId: 'sub-1',
                scope: '/subscriptions/sub-1/resourceGroups/rg-app',
                principalId: 'pid-2',
                principalType: 'Group',
            },
            {
                subscriptionId: 'sub-1',
                scope: '/subscriptions/sub-1/resourceGroups/rg-app/providers/Microsoft.Compute/virtualMachines/vm1',
                principalId: 'pid-2',
                principalType: 'Group',
            },
        ],
        resolved
    );

    assert.equal(report.subscriptions.length, 1);
    const sub = report.subscriptions[0];
    assert.deepEqual(sub.subscriptionOwnerTags, { Owner: 'alice@example.com' });
    assert.equal(sub.totalResourceGroups, 2);
    assert.equal(sub.resourceGroupsWithOwnerTags.length, 1);
    assert.equal(sub.rbacOwners.subscriptionScope[0].emailOrUpn, 'alice@example.com');
    assert.equal(sub.rbacOwners.resourceGroupScopes['rg-app'].length, 1);
    assert.equal(sub.rbacOwners.resourceScopeCount, 1);
    assert.equal(resolveOutputPath(['--out', '.']), path.join(process.cwd(), DEFAULT_OUT_FILE));
    assert.equal(resolveOutputPath(['--out', 'custom.json']), path.resolve(process.cwd(), 'custom.json'));
    console.log('Self-check passed.');
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.includes('--self-check')) {
        runSelfCheck();
        return;
    }

    const skipGraph = args.includes('--no-graph');
    const outputPath = resolveOutputPath(args);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });

    const { AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET } = process.env;
    if (!AZURE_TENANT_ID || !AZURE_CLIENT_ID || !AZURE_CLIENT_SECRET) {
        throw new Error('Missing required Azure env vars (AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET).');
    }

    console.log(`Output file: ${outputPath}`);
    const credential = new ClientSecretCredential(AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET);
    const rgClient = new ResourceGraphClient(credential);

    console.log('1/3 Querying Subscriptions (ResourceContainers)...');
    const subs = await queryAllPages<RawSubRow>(
        rgClient,
        `ResourceContainers
         | where type =~ 'microsoft.resources/subscriptions'
         | project subscriptionId, name, state = tostring(properties.state), tags`
    );
    console.log(`    Found ${subs.length} accessible subscription(s)`);

    console.log('2/3 Querying Resource Groups (ResourceContainers)...');
    const rgs = await queryAllPages<RawRgRow>(
        rgClient,
        `ResourceContainers
         | where type =~ 'microsoft.resources/subscriptions/resourcegroups'
         | project name, subscriptionId, location, tags`
    );
    console.log(`    Found ${rgs.length} resource group(s)`);

    console.log('3/3 Querying RBAC Owner role assignments (AuthorizationResources)...');
    let rbacRows: RawRbacRow[] = [];
    let rbacQueryStatus = 'ok';
    try {
        rbacRows = await queryAllPages<RawRbacRow>(
            rgClient,
            `AuthorizationResources
             | where type =~ 'microsoft.authorization/roleassignments'
             | extend roleDefId = tolower(tostring(properties.roleDefinitionId))
             | where roleDefId endswith '/${OWNER_ROLE_DEF_GUID}'
             | extend scope = tostring(properties.scope)
             | extend principalId = tostring(properties.principalId)
             | extend principalType = tostring(properties.principalType)
             | project subscriptionId, scope, principalId, principalType`
        );
        console.log(`    Found ${rbacRows.length} Owner role assignment(s)`);
    } catch (err: any) {
        rbacQueryStatus = `error: ${err?.message || String(err)}`;
        console.warn(`    Skipped RBAC query (${rbacQueryStatus})`);
    }

    const uniquePrincipalIds = [...new Set(rbacRows.map((r) => clean(r.principalId)).filter(Boolean))];
    let resolvedPrincipals = new Map<string, { displayName: string | null; emailOrUpn: string | null }>();
    let graphError: string | null = null;

    if (!skipGraph && uniquePrincipalIds.length > 0) {
        console.log(`Resolving ${uniquePrincipalIds.length} unique principal ID(s) via Microsoft Graph...`);
        const graphRes = await resolvePrincipalsViaGraph(credential, uniquePrincipalIds);
        resolvedPrincipals = graphRes.resolved;
        graphError = graphRes.error;
        if (graphError) {
            console.warn(`    Graph resolution unavailable (${graphError}) — keeping raw principalId GUIDs.`);
        } else {
            console.log(`    Resolved ${resolvedPrincipals.size}/${uniquePrincipalIds.length} principal(s)`);
        }
    }

    const report = buildReport(subs, rgs, rbacRows, resolvedPrincipals);
    const payload = {
        generatedAt: new Date().toISOString(),
        accessibleSubscriptions: report.subscriptions.length,
        subscriptionsWithOwnerTag: report.subscriptions.filter((s) => Object.keys(s.subscriptionOwnerTags).length > 0).length,
        totalResourceGroups: rgs.length,
        resourceGroupsWithOwnerTag: report.subscriptions.reduce((sum, s) => sum + s.resourceGroupsWithOwnerTags.length, 0),
        totalOwnerRoleAssignments: rbacRows.length,
        rbacQueryStatus,
        graphResolution: {
            skipped: skipGraph,
            totalUniquePrincipals: uniquePrincipalIds.length,
            resolvedCount: resolvedPrincipals.size,
            error: graphError,
        },
        allSubscriptionTagKeys: report.allSubscriptionTagKeys,
        allResourceGroupTagKeys: report.allResourceGroupTagKeys,
        subscriptions: report.subscriptions,
    };

    fs.writeFileSync(outputPath, JSON.stringify(payload, null, 2), 'utf8');
    console.log(`\nWrote Resource Graph owner report to ${outputPath}`);
    console.log(`  Subscriptions with owner tag:   ${payload.subscriptionsWithOwnerTag}/${payload.accessibleSubscriptions}`);
    console.log(`  Resource groups with owner tag: ${payload.resourceGroupsWithOwnerTag}/${payload.totalResourceGroups}`);
    console.log(`  RBAC Owner assignments found:   ${payload.totalOwnerRoleAssignments} (${rbacQueryStatus})`);
}

main().catch((err) => {
    console.error('Failed to query Azure Resource Graph:', err?.message || err);
    process.exit(1);
});
