import assert from 'node:assert/strict';
import {
  buildAzureOwnershipIndex,
  extractEmails,
  normalizeSubscriptionId,
  type RawRgRow,
  type RawRbacRow,
  type RawSubRow,
  type ResolvedPrincipal,
} from './accountOwnershipService.ts';

function runSelfCheck() {
  // 1. Multi-email extraction & normalization
  assert.deepEqual(extractEmails('Nitesh.1.Sharma@coforge.com, ANIL.PAREEK@coforge.com; nitesh.1.sharma@coforge.com'), [
    'nitesh.1.sharma@coforge.com',
    'anil.pareek@coforge.com',
  ]);
  assert.deepEqual(extractEmails('Ranjith Dandala'), []);
  assert.deepEqual(extractEmails(null), []);

  // 2. Subscription ID normalization
  assert.equal(normalizeSubscriptionId('/subscriptions/34D9F509-17D3-4909-89E8-21BF8E4C5C5E/'), '34d9f509-17d3-4909-89e8-21bf8e4c5c5e');
  assert.equal(normalizeSubscriptionId('62C20A69-3D5B-4384-AE1F-0BBBACCF912D'), '62c20a69-3d5b-4384-ae1f-0bbbaccf912d');

  // 3. Azure ownership index across Subscription/RG RBAC + Subscription/RG tags
  const subs: RawSubRow[] = [
    {
      subscriptionId: 'sub-1',
      name: 'Adecco-Coforge',
      state: 'Enabled',
      tags: {
        'Owner Name': 'Nitesh.1.Sharma@coforge.com, ANIL.PAREEK@coforge.com',
        'Requestor Name': 'Nitesh.1.Sharma@coforge.com',
        'Project Code': '14560-DE-SZ4-FP',
        'Cost Code': '0082997799',
        Env: 'Prod',
      },
    },
    {
      subscriptionId: 'sub-2',
      name: 'Abu Dhabi Distribution Company',
      state: 'Enabled',
      tags: {},
    },
  ];

  const rgs: RawRgRow[] = [
    {
      subscriptionId: 'sub-2',
      name: 'RG_ADDC',
      location: 'uaenorth',
      tags: { 'Project Owner': 'ranjith.dandala@coforge.com' },
    },
  ];

  const rbacRows: RawRbacRow[] = [
    {
      subscriptionId: 'sub-1',
      scope: '/subscriptions/sub-1',
      principalId: 'p-nitesh',
      principalType: 'User',
    },
    {
      subscriptionId: 'sub-2',
      scope: '/subscriptions/sub-2/resourceGroups/RG_ADDC',
      principalId: 'p-amit',
      principalType: 'User',
    },
    {
      subscriptionId: 'sub-2',
      scope: '/subscriptions/sub-2/resourceGroups/RG_ADDC/providers/Microsoft.Compute/virtualMachines/vm1',
      principalId: 'p-vm-only',
      principalType: 'User',
    },
  ];

  const principals = new Map<string, ResolvedPrincipal>([
    ['p-nitesh', { displayName: 'Nitesh Sharma', emailOrUpn: 'Nitesh.1.Sharma@coforge.com' }],
    ['p-amit', { displayName: 'Amit Sharma', emailOrUpn: 'amit.26.sharma@coforge.com' }],
    ['p-vm-only', { displayName: 'VM Only', emailOrUpn: 'vmonly@coforge.com' }],
  ]);

  const index = buildAzureOwnershipIndex(subs, rgs, rbacRows, principals);

  const niteshAccounts = index.get('nitesh.1.sharma@coforge.com') || [];
  assert.equal(niteshAccounts.length, 1);
  assert.equal(niteshAccounts[0].accountId, 'sub-1');
  assert.equal(niteshAccounts[0].projectCode, '14560-DE-SZ4-FP');
  assert.equal(niteshAccounts[0].costCode, '0082997799');
  assert.deepEqual(niteshAccounts[0].ownershipSources, [
    'RBAC Owner (Subscription)',
    'Subscription Tag: Owner Name',
    'Subscription Tag: Requestor Name',
  ]);

  const anilAccounts = index.get('anil.pareek@coforge.com') || [];
  assert.equal(anilAccounts.length, 1);
  assert.deepEqual(anilAccounts[0].ownershipSources, ['Subscription Tag: Owner Name']);

  const amitAccounts = index.get('amit.26.sharma@coforge.com') || [];
  assert.equal(amitAccounts.length, 1);
  assert.equal(amitAccounts[0].accountId, 'sub-2');
  assert.deepEqual(amitAccounts[0].ownershipSources, ['RBAC Owner (RG: RG_ADDC)']);

  const ranjithAccounts = index.get('ranjith.dandala@coforge.com') || [];
  assert.equal(ranjithAccounts.length, 1);
  assert.deepEqual(ranjithAccounts[0].ownershipSources, ['RG Tag: Project Owner (RG_ADDC)']);

  // Resource-level RBAC scope and unrelated users should not appear
  assert.equal(index.get('vmonly@coforge.com'), undefined);
  assert.equal(index.get('stranger@coforge.com'), undefined);

  console.log('✅ accountOwnershipService self-check passed!');
}

runSelfCheck();
