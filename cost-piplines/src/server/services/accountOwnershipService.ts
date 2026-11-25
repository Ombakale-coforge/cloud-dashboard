import { ClientSecretCredential } from '@azure/identity';
import { ResourceGraphClient } from '@azure/arm-resourcegraph';
import { getOrgAccountsMetadata } from '../routes/aws.ts';

const OWNER_ROLE_DEF_GUID = '8e3af657-a8ff-443c-a75c-2fe8c4bcb635';
const OWNER_TAG_KEY_PATTERN =
  /(owner|created[\s_-]*by|creator|managed[\s_-]*by|contact|poc|spoc|manager|lead|team|maintainer|email|author|request(?:or|er))/i;
const EMAIL_EXTRACT_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;
const CACHE_TTL_MS = 30 * 60 * 1000;

export interface OwnedCloudAccount {
  cloudProvider: 'azure' | 'aws';
  accountId: string;
  accountName: string;
  parentAccountId?: string | null;
  state?: string | null;
  ownershipSources: string[];
  projectCode?: string | null;
  costCode?: string | null;
}

export interface RawSubRow {
  subscriptionId: string;
  name: string;
  state?: string;
  tags?: Record<string, unknown> | null;
}

export interface RawRgRow {
  name: string;
  subscriptionId: string;
  location?: string;
  tags?: Record<string, unknown> | null;
}

export interface RawRbacRow {
  subscriptionId: string;
  scope: string;
  principalId: string;
  principalType?: string;
}

export interface ResolvedPrincipal {
  displayName: string | null;
  emailOrUpn: string | null;
}

function clean(val: unknown): string {
  return typeof val === 'string' ? val.trim() : val == null ? '' : String(val).trim();
}

export function extractEmails(raw: unknown): string[] {
  const text = clean(raw);
  if (!text) return [];
  const matches = text.match(EMAIL_EXTRACT_RE) || [];
  return Array.from(new Set(matches.map((m) => m.toLowerCase())));
}

export function normalizeSubscriptionId(raw: string): string {
  return clean(raw).replace(/^\/subscriptions\//i, '').replace(/\/+$/, '').toLowerCase();
}

function pickTagValue(tags: Record<string, unknown> | null | undefined, keys: RegExp): string | null {
  if (!tags || typeof tags !== 'object') return null;
  for (const [rawK, rawV] of Object.entries(tags)) {
    const k = clean(rawK);
    const v = clean(rawV);
    if (k && v && keys.test(k)) return v;
  }
  return null;
}

function classifyRbacScope(scope: string): {
  kind: 'subscription' | 'resourceGroup' | 'other';
  resourceGroup?: string;
} {
  const normalized = clean(scope).replace(/\/+$/, '');
  if (/^\/subscriptions\/[^/]+$/i.test(normalized)) {
    return { kind: 'subscription' };
  }
  const rgExact = normalized.match(/^\/subscriptions\/[^/]+\/resourceGroups\/([^/]+)$/i);
  if (rgExact) {
    return { kind: 'resourceGroup', resourceGroup: rgExact[1] };
  }
  return { kind: 'other' };
}

export function buildAzureOwnershipIndex(
  subs: RawSubRow[],
  rgs: RawRgRow[],
  rbacRows: RawRbacRow[],
  resolvedPrincipals: Map<string, ResolvedPrincipal>
): Map<string, OwnedCloudAccount[]> {
  const subMeta = new Map<
    string,
    {
      subscriptionId: string;
      subscriptionName: string;
      state: string | null;
      projectCode: string | null;
      costCode: string | null;
    }
  >();

  // Map<email, Map<subscriptionId, { meta, sources: Set<string> }>>
  const emailMap = new Map<
    string,
    Map<
      string,
      {
        accountId: string;
        accountName: string;
        state: string | null;
        projectCode: string | null;
        costCode: string | null;
        sources: Set<string>;
      }
    >
  >();

  const addOwnership = (email: string, subId: string, sourceLabel: string) => {
    const normEmail = email.trim().toLowerCase();
    const meta = subMeta.get(subId);
    if (!normEmail || !meta) return;

    let bySub = emailMap.get(normEmail);
    if (!bySub) {
      bySub = new Map();
      emailMap.set(normEmail, bySub);
    }
    let entry = bySub.get(subId);
    if (!entry) {
      entry = {
        accountId: meta.subscriptionId,
        accountName: meta.subscriptionName,
        state: meta.state,
        projectCode: meta.projectCode,
        costCode: meta.costCode,
        sources: new Set(),
      };
      bySub.set(subId, entry);
    }
    entry.sources.add(sourceLabel);
  };

  for (const s of subs) {
    const subId = normalizeSubscriptionId(s.subscriptionId);
    if (!subId) continue;
    const projectCode = pickTagValue(s.tags, /^(project[\s_]*code|wbs([\s_]*code)?)$/i);
    const costCode = pickTagValue(s.tags, /^(cost[\s_]*(center|centre|code)([\s_]*code)?|cc([\s_]*code)?)$/i);

    subMeta.set(subId, {
      subscriptionId: subId,
      subscriptionName: clean(s.name) || subId,
      state: clean(s.state) || null,
      projectCode,
      costCode,
    });

    if (s.tags && typeof s.tags === 'object') {
      for (const [rawK, rawV] of Object.entries(s.tags)) {
        const k = clean(rawK);
        if (!k || !OWNER_TAG_KEY_PATTERN.test(k)) continue;
        for (const em of extractEmails(rawV)) {
          addOwnership(em, subId, `Subscription Tag: ${k}`);
        }
      }
    }
  }

  for (const rg of rgs) {
    const subId = normalizeSubscriptionId(rg.subscriptionId);
    const rgName = clean(rg.name);
    if (!subId || !rgName || !rg.tags || typeof rg.tags !== 'object') continue;
    for (const [rawK, rawV] of Object.entries(rg.tags)) {
      const k = clean(rawK);
      if (!k || !OWNER_TAG_KEY_PATTERN.test(k)) continue;
      for (const em of extractEmails(rawV)) {
        addOwnership(em, subId, `RG Tag: ${k} (${rgName})`);
      }
    }
  }

  for (const r of rbacRows) {
    const subId = normalizeSubscriptionId(r.subscriptionId);
    if (!subId) continue;
    const scopeInfo = classifyRbacScope(r.scope);
    if (scopeInfo.kind === 'other') continue;

    const pid = clean(r.principalId).toLowerCase();
    const principal = resolvedPrincipals.get(pid);
    if (!principal?.emailOrUpn) continue;

    const sourceLabel =
      scopeInfo.kind === 'subscription'
        ? 'RBAC Owner (Subscription)'
        : `RBAC Owner (RG: ${scopeInfo.resourceGroup})`;

    for (const em of extractEmails(principal.emailOrUpn)) {
      addOwnership(em, subId, sourceLabel);
    }
  }

  const out = new Map<string, OwnedCloudAccount[]>();
  for (const [email, subEntries] of emailMap.entries()) {
    const list: OwnedCloudAccount[] = Array.from(subEntries.values())
      .map((item) => ({
        cloudProvider: 'azure' as const,
        accountId: item.accountId,
        accountName: item.accountName,
        parentAccountId: 'azure-root',
        state: item.state,
        ownershipSources: Array.from(item.sources).sort(),
        projectCode: item.projectCode,
        costCode: item.costCode,
      }))
      .sort((a, b) => a.accountName.localeCompare(b.accountName, undefined, { sensitivity: 'base' }));
    out.set(email, list);
  }
  return out;
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
): Promise<Map<string, ResolvedPrincipal>> {
  const resolved = new Map<string, ResolvedPrincipal>();
  if (principalIds.length === 0) return resolved;

  try {
    const token = await credential.getToken('https://graph.microsoft.com/.default');
    if (!token?.token) return resolved;

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
        console.warn(`[AzureOwnership] MS Graph getByIds HTTP ${resp.status}`);
        break;
      }
      const data = (await resp.json()) as { value?: Array<Record<string, unknown>> };
      for (const obj of data.value || []) {
        const id = clean(obj.id).toLowerCase();
        if (!id) continue;
        resolved.set(id, {
          displayName: clean(obj.displayName) || null,
          emailOrUpn: clean(obj.mail || obj.userPrincipalName || obj.appId) || null,
        });
      }
    }
  } catch (err: any) {
    console.warn('[AzureOwnership] Graph principal resolution skipped:', err?.message || err);
  }

  return resolved;
}

async function fetchAzureOwnershipIndex(): Promise<Map<string, OwnedCloudAccount[]>> {
  const tenantId = clean(process.env.AZURE_TENANT_ID);
  const clientId = clean(process.env.AZURE_CLIENT_ID);
  const clientSecret = clean(process.env.AZURE_CLIENT_SECRET);
  if (!tenantId || !clientId || !clientSecret) {
    return new Map();
  }

  const credential = new ClientSecretCredential(tenantId, clientId, clientSecret);
  const rgClient = new ResourceGraphClient(credential);

  const [subs, rgs] = await Promise.all([
    queryAllPages<RawSubRow>(
      rgClient,
      `ResourceContainers
       | where type =~ 'microsoft.resources/subscriptions'
       | project subscriptionId, name, state = tostring(properties.state), tags`
    ),
    queryAllPages<RawRgRow>(
      rgClient,
      `ResourceContainers
       | where type =~ 'microsoft.resources/subscriptions/resourcegroups'
       | project name, subscriptionId, location, tags`
    ),
  ]);

  let rbacRows: RawRbacRow[] = [];
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
  } catch (err: any) {
    console.warn('[AzureOwnership] RBAC Owner query skipped:', err?.message || err);
  }

  const uniquePrincipalIds = Array.from(new Set(rbacRows.map((r) => clean(r.principalId)).filter(Boolean)));
  const resolvedPrincipals = await resolvePrincipalsViaGraph(credential, uniquePrincipalIds);

  return buildAzureOwnershipIndex(subs, rgs, rbacRows, resolvedPrincipals);
}

// ponytail: single-process in-memory 30m cache; if scaled across multiple server instances,
// persist the resolved snapshot into a SQL Server table instead of process memory.
let azureCache: {
  expiresAt: number;
  index?: Map<string, OwnedCloudAccount[]>;
  inflight?: Promise<Map<string, OwnedCloudAccount[]>>;
} = { expiresAt: 0 };

export function clearAzureOwnershipCache(): void {
  azureCache = { expiresAt: 0 };
}

async function getAzureOwnershipIndex(forceRefresh = false): Promise<Map<string, OwnedCloudAccount[]>> {
  const now = Date.now();
  if (!forceRefresh && azureCache.index && azureCache.expiresAt > now) {
    return azureCache.index;
  }
  if (!forceRefresh && azureCache.inflight) {
    return azureCache.inflight;
  }

  const inflight = fetchAzureOwnershipIndex()
    .then((index) => {
      azureCache = { expiresAt: Date.now() + CACHE_TTL_MS, index };
      return index;
    })
    .catch((err) => {
      console.warn('[AzureOwnership] Resource Graph refresh failed:', err?.message || err);
      azureCache = azureCache.index ? { expiresAt: Date.now() + 60_000, index: azureCache.index } : { expiresAt: 0 };
      return azureCache.index || new Map<string, OwnedCloudAccount[]>();
    });

  azureCache = { expiresAt: azureCache.expiresAt, index: azureCache.index, inflight };
  return inflight;
}

async function getOwnedAwsAccounts(normalizedEmail: string): Promise<OwnedCloudAccount[]> {
  const results = await Promise.allSettled([
    getOrgAccountsMetadata('account-1'),
    getOrgAccountsMetadata('account-2'),
  ]);

  const seen = new Map<string, { account: OwnedCloudAccount; sources: Set<string> }>();
  const configIds = ['account-1', 'account-2'];

  results.forEach((res, idx) => {
    if (res.status !== 'fulfilled') return;
    const configId = configIds[idx];
    for (const acc of res.value.values()) {
      const accountEmailMatched = acc.email && extractEmails(acc.email).includes(normalizedEmail);
      const tagEmailMatched = Array.isArray(acc.ownerEmails) && acc.ownerEmails.includes(normalizedEmail);
      if (!accountEmailMatched && !tagEmailMatched) continue;

      let existing = seen.get(acc.id);
      if (!existing) {
        existing = {
          account: {
            cloudProvider: 'aws',
            accountId: acc.id,
            accountName: acc.name || acc.id,
            parentAccountId: configId,
            state: acc.status || 'ACTIVE',
            ownershipSources: [],
            projectCode: acc.wbsCode || null,
            costCode: null,
          },
          sources: new Set(),
        };
        seen.set(acc.id, existing);
      }
      if (accountEmailMatched) existing.sources.add('AWS Account Email');
      if (tagEmailMatched) existing.sources.add('AWS Org Tag');
    }
  });

  return Array.from(seen.values())
    .map(({ account, sources }) => ({
      ...account,
      ownershipSources: Array.from(sources).sort(),
    }))
    .sort((a, b) => a.accountName.localeCompare(b.accountName, undefined, { sensitivity: 'base' }));
}

export async function getOwnedCloudAccounts(
  email: string,
  options?: { forceRefresh?: boolean }
): Promise<OwnedCloudAccount[]> {
  const normalizedEmail = clean(email).toLowerCase();
  if (!normalizedEmail) return [];

  const [azureIndex, awsOwned] = await Promise.all([
    getAzureOwnershipIndex(Boolean(options?.forceRefresh)),
    getOwnedAwsAccounts(normalizedEmail),
  ]);

  const azureOwned = azureIndex.get(normalizedEmail) || [];
  return [...azureOwned, ...awsOwned];
}

export async function findOwnedAccount(
  email: string,
  provider: 'azure' | 'aws' | 'gcp',
  accountId: string,
  accountName?: string
): Promise<OwnedCloudAccount | null> {
  if (provider === 'gcp') return null;
  const owned = await getOwnedCloudAccounts(email);
  const normId = provider === 'azure' ? normalizeSubscriptionId(accountId) : clean(accountId).toLowerCase();
  const normName = clean(accountName).toLowerCase();

  return (
    owned.find((a) => {
      if (a.cloudProvider !== provider) return false;
      const candidateId = provider === 'azure' ? normalizeSubscriptionId(a.accountId) : clean(a.accountId).toLowerCase();
      if (normId && candidateId === normId) return true;
      if (normName && a.accountName.toLowerCase() === normName) return true;
      return false;
    }) || null
  );
}
