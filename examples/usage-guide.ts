/**
 * ============================================================================
 *  LinkToAny Unified API SDK — Developer Usage Guide
 * ============================================================================
 *
 * A runnable, end-to-end walkthrough of the SDK. Every section is a small,
 * copy-pasteable example of one Unified API workflow:
 *
 *   1. Create a client (environments, tenant context)
 *   2. Discover integrations & their documentation
 *   3. Connect an account to an integration
 *   4. Read unified records (pages, filters, full iteration)
 *   5. Write unified records
 *   6. Manage unified entity contracts
 *   7. Generate contracts with AI
 *   8. Observability — request logs & rate limits
 *   9. Error handling patterns
 *
 * Run it two ways:
 *
 *   # Mock mode (default — no credentials, no network; great first run)
 *   npx tsx examples/usage-guide.ts
 *
 *   # Live mode (against api.staging.linktoany.com)
 *   LINKTOANY_API_KEY=...  LINKTOANY_SYSTEM_ID=...  npx tsx examples/usage-guide.ts
 *
 * Live-mode env vars:
 *   LINKTOANY_API_KEY     required — your API key
 *   LINKTOANY_ENV         'dev' (default) or 'prod'
 *   LINKTOANY_ORG_ID      optional — organisation / tenant id
 *   LINKTOANY_SYSTEM_ID   optional — integration id for discovery + connect
 *   LINKTOANY_ACCOUNT_ID  optional — connected account id for record calls
 * ============================================================================
 */

import {
  LinkToAny,
  NotFoundError,
  RateLimitError,
  ValidationError,
  LinkToAnyError
} from '../src/index.js';

// ---------------------------------------------------------------------------
// Setup — mock mode fakes the API so the guide runs anywhere
// ---------------------------------------------------------------------------

const LIVE = Boolean(process.env.LINKTOANY_API_KEY);
const SYSTEM_ID = process.env.LINKTOANY_SYSTEM_ID ?? 'a1b2c3d4e5f6a1b2c3d4e5f6';
const ACCOUNT_ID = process.env.LINKTOANY_ACCOUNT_ID ?? 'b2c3d4e5f6a1b2c3d4e5f6a1';

function heading(title: string): void {
  console.log(`\n${'='.repeat(74)}\n  ${title}\n${'='.repeat(74)}`);
}

// ---------------------------------------------------------------------------
// 1. Create a client
// ---------------------------------------------------------------------------
//
// environment: 'dev'  → https://api.staging.linktoany.com
// environment: 'prod' → https://api.linktoany.com   (default)
//
// The API key is sent as `Authorization: Bearer <key>`. organisationId / userId /
// applicationId become tenant-context headers on every request.

const client = new LinkToAny({
  apiKey: process.env.LINKTOANY_API_KEY ?? 'demo-key',
  environment: (process.env.LINKTOANY_ENV as 'dev' | 'prod') ?? 'dev',
  organisationId: process.env.LINKTOANY_ORG_ID,
  timeoutMs: 30_000, // per-request timeout (default 30s)
  maxRetries: 2, // automatic retries on 429/5xx (default 2)
  ...(LIVE ? {} : { fetch: mockUnifiedApi() }) // mock mode only
});

async function main(): Promise<void> {
  console.log(`Mode: ${LIVE ? 'LIVE' : 'MOCK (set LINKTOANY_API_KEY for live mode)'}`);
  console.log(`Base URL: ${client.baseUrl}`);

  heading('1. Health check');
  // Cheapest way to verify connectivity and environment selection.
  const health = await client.health();
  console.log(`service=${health.service} status=${health.status} version=${health.version}`);

  // -------------------------------------------------------------------------
  heading('2. Discover integrations & their documentation');
  // The Unified API catalogues integrations (Shopify, QuickBooks, ...).
  // `client.docs.describeIntegration` pulls everything known about one —
  // entities, read/write capability, filters — in a single parallel fetch.

  const { data: integrations } = await client.integrations.list({ status: 'active' });
  console.log(`Catalogue: ${integrations.map(i => i.name).join(', ')}`);

  const docs = await client.docs.describeIntegration(SYSTEM_ID);
  console.log(`\nIntegration: ${docs.integration?.name} (${docs.integration?.supportedAuthTypes?.join('/')})`);
  console.log('Entities:');
  for (const entity of docs.entities) {
    const capability = [entity.readable && 'read', entity.writable && 'write']
      .filter(Boolean)
      .join('+');
    const filters = entity.filters.map(f => f.paramName).join(', ') || 'none';
    console.log(`  - ${entity.entityType.padEnd(12)} [${capability}]  filters: ${filters}`);
  }
  if (docs.warnings.length > 0) {
    console.log('Warnings:', docs.warnings); // failed sources never crash the call
  }

  // Focused helper: just the filters for one entity.
  const orderFilters = await client.docs.getEntityFilters(SYSTEM_ID, 'order');
  console.log(`\n'order' filters: ${orderFilters.map(f => `${f.paramName}:${f.type}`).join(', ')}`);

  // -------------------------------------------------------------------------
  heading('3. Connect an account to an integration');
  // One connect per merchant per integration. OAuth integrations return an
  // authUrl to redirect the user to; direct-auth integrations (apikey,
  // basic, bearer) connect immediately and return the accountId.

  const connection = await client.auth.connectAccount(SYSTEM_ID, 'shopify', {
    merchantId: 'merchant-42',
    shop: 'demo-store.myshopify.com',
    returnUrl: 'https://app.example.com/integrations/done'
  });

  let accountId = ACCOUNT_ID;
  if (connection.data.authType === 'oauth') {
    console.log(`OAuth flow — redirect the user to:\n  ${connection.data.authUrl}`);
    // After the redirect completes, poll the connection status:
    const status = await client.auth.getStatus(accountId);
    console.log(`Connection status: ${status.data.status}`);
  } else {
    accountId = connection.data.accountId!;
    console.log(`Direct auth — connected immediately. accountId=${accountId}`);
  }

  // Token health & maintenance (normally automatic):
  const tokenStatus = await client.auth.getTokenStatus(accountId);
  console.log(`Token status: ${JSON.stringify(tokenStatus.data)}`);

  // -------------------------------------------------------------------------
  heading('4. Read unified records');
  // The core promise of the Unified API: the SAME call and the SAME record
  // shape for every integration. `entityType` is a unified entity from your
  // contracts ('products', 'orders', ...).

  // 4a. One page, with filters and page size:
  const page = await client.records.list(accountId, 'orders', {
    pageSize: 2,
    filters: { status: 'paid' } // keys come from docs.getEntityFilters(...)
  });
  console.log(`Page of ${page.data.length} (hasMore=${page.pagination?.hasMore}):`);
  for (const order of page.data) {
    console.log(`  ${JSON.stringify(order)}`);
  }

  // 4b. Everything, cursor handled for you:
  let total = 0;
  for await (const _order of client.records.iterate(accountId, 'orders', { pageSize: 2 })) {
    total++;
  }
  console.log(`records.iterate walked ${total} orders across all pages`);

  // 4c. Typed records:
  interface UnifiedOrder {
    id: string;
    status: string;
    total: number;
  }
  const typed = await client.records.list<UnifiedOrder>(accountId, 'orders', { pageSize: 1 });
  if (typed.data[0]) {
    console.log(`Typed access: order ${typed.data[0].id} total=${typed.data[0].total}`);
  }

  // -------------------------------------------------------------------------
  heading('5. Write unified records');
  // Write once in the unified schema — the platform validates against the
  // entity contract, transforms to the integration's native shape, pushes.

  const writeResult = await client.records.create(accountId, 'products', {
    name: 'Espresso Beans 1kg',
    sku: 'ESP-1KG',
    price: 18.5
  });
  console.log(`Write success=${writeResult.success}: ${JSON.stringify(writeResult.data)}`);

  // -------------------------------------------------------------------------
  heading('6. Unified entity contracts');
  // A contract = the unified Zod schema for an entity + mappings onto each
  // integration's read/write operations. Usually AI-generated (section 7),
  // but fully manageable by hand.

  const contracts = await client.entities.list({ onlyEnabled: true });
  console.log(
    `Contracts: ${contracts.data.map(c => `${c.entityType} (${c.readMappings.length}r/${c.writeMappings.length}w)`).join(', ')}`
  );

  // -------------------------------------------------------------------------
  heading('7. Generate contracts with AI');
  // Point the platform at integration operations and let AI produce the
  // unified schema + transformation rules. Async — poll until done.

  const { data: task } = await client.entities.generate({
    systemIds: [SYSTEM_ID],
    syncRequestConfigIds: ['c3d4e5f6a1b2c3d4e5f6a1b2'] // auto-discovery mode
  });
  console.log(`Generation task started: ${task._id} (${task.status})`);

  const finished = await client.entities.waitForGeneration(task._id, {
    intervalMs: LIVE ? 5_000 : 10,
    timeoutMs: LIVE ? 600_000 : 5_000
  });
  console.log(`Generation finished: ${finished.status}`);

  // -------------------------------------------------------------------------
  heading('8. Observability — request logs & rate limits');
  // Every Unified API call is logged. Slice by account, entity, success...

  const logs = await client.requests.list({ accountId, limit: 5 });
  for (const log of logs.data) {
    console.log(`  ${log.method} ${log.entityType} → ${log.statusCode} (${log._id})`);
  }

  const limits = await client.rateLimits.list();
  console.log(`Rate limit configs: ${limits.data.length}`);

  // -------------------------------------------------------------------------
  heading('9. Error handling patterns');
  // Every failure is a typed subclass of LinkToAnyError. Retries for 429/5xx
  // happen automatically first; you only catch what survived them.

  try {
    await client.records.list('0'.repeat(24), 'orders');
  } catch (err) {
    if (err instanceof NotFoundError) {
      console.log(`NotFoundError as expected: "${err.message}" (status=${err.status})`);
    } else if (err instanceof ValidationError) {
      console.log('Bad payload:', err.body);
    } else if (err instanceof RateLimitError) {
      console.log(`Rate limited — retry in ${err.retryAfterSeconds}s`);
    } else if (err instanceof LinkToAnyError) {
      console.log(`API error ${err.status}: ${err.message} (requestId=${err.requestId})`);
    } else {
      throw err; // programming error — do not swallow
    }
  }

  console.log('\nDone. Full API reference: npm run docs  (TypeDoc → ./docs)\n');
}

// ===========================================================================
// Mock Unified API (mock mode only) — a tiny in-memory fake so this guide
// runs with zero credentials. Not part of the SDK; skip reading unless you
// want to see the wire format the SDK expects.
// ===========================================================================

function mockUnifiedApi(): typeof fetch {
  const ORDERS = [
    { id: 'ord_1', status: 'paid', total: 42.5 },
    { id: 'ord_2', status: 'paid', total: 13.0 },
    { id: 'ord_3', status: 'paid', total: 99.9 }
  ];
  const FILTERS = [
    { paramName: 'status', label: 'Order Status', type: 'enum', options: [{ label: 'Paid', value: 'paid' }] },
    { paramName: 'from_date', label: 'From Date', type: 'date' }
  ];

  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? 'GET';
    const path = url.pathname;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });

    if (path === '/health') {
      return json({ status: 'healthy', service: 'flow-unified-api', timestamp: 'now', version: '1.0.0' });
    }
    if (path === '/account/system' && method === 'GET') {
      return json({ success: true, data: [
        { _id: SYSTEM_ID, name: 'Shopify', status: 'active' },
        { _id: 'd4e5f6a1b2c3d4e5f6a1b2c3', name: 'QuickBooks', status: 'active' }
      ] });
    }
    if (path === `/account/system/${SYSTEM_ID}`) {
      return json({ success: true, data: {
        _id: SYSTEM_ID, name: 'Shopify', description: 'E-commerce platform',
        supportedAuthTypes: ['oauth2'], status: 'active'
      } });
    }
    if (path === '/system-integration/sync-configs') {
      return json({ success: true, data: [
        { _id: '1'.repeat(24), systemId: SYSTEM_ID, entityType: 'order', availableFilters: FILTERS },
        { _id: '2'.repeat(24), systemId: SYSTEM_ID, entityType: 'product', availableFilters: [] }
      ] });
    }
    if (path === '/system-integration/configs') {
      return json({ success: true, data: [
        { _id: '3'.repeat(24), systemId: SYSTEM_ID, entityType: 'product', action: 'create' }
      ] });
    }
    if (path === '/unified' && method === 'GET') {
      return json({ success: true, data: [
        {
          entityType: 'orders', unifiedZodSchema: 'z.object({...})',
          readMappings: [{ key: 'shopify', systemId: SYSTEM_ID, sourceEntityType: 'order' }],
          writeMappings: []
        },
        {
          entityType: 'products', unifiedZodSchema: 'z.object({...})',
          readMappings: [{ key: 'shopify', systemId: SYSTEM_ID, sourceEntityType: 'product' }],
          writeMappings: [{ key: 'shopify', systemId: SYSTEM_ID, targetEntityType: 'product' }]
        }
      ] });
    }
    if (path.startsWith('/account/start/')) {
      return json({
        success: true, message: 'ok', systemId: SYSTEM_ID, application: 'shopify',
        data: { authType: 'oauth', authUrl: 'https://demo-store.myshopify.com/admin/oauth/authorize?...', instructions: 'Redirect user to authUrl' }
      });
    }
    if (path.startsWith('/oauth/status/')) {
      return json({ success: true, data: { accountId: ACCOUNT_ID, status: 'authenticated' } });
    }
    if (path.endsWith('/token-status')) {
      return json({ success: true, data: { valid: true, expiresAt: '2027-01-01T00:00:00Z' } });
    }
    if (path === `/unified/${ACCOUNT_ID}/orders` && method === 'GET') {
      const cursor = Number(url.searchParams.get('cursor') ?? 0);
      const pageSize = Number(url.searchParams.get('pageSize') ?? 100);
      const slice = ORDERS.slice(cursor, cursor + pageSize);
      const next = cursor + pageSize;
      return json({
        success: true, data: slice,
        pagination: { cursor: next < ORDERS.length ? String(next) : null, hasMore: next < ORDERS.length, pageSize }
      });
    }
    if (path === `/unified/${ACCOUNT_ID}/products` && method === 'POST') {
      const record = JSON.parse(String(init?.body ?? '{}'));
      return json({ success: true, data: [{ key: 'shopify', status: 'created', externalId: 'prod_991', input: record.sku }] });
    }
    if (path === '/unified/generate' && method === 'POST') {
      return json({ success: true, data: { _id: '9'.repeat(24), status: 'processing' } }, 202);
    }
    if (path === `/unified/generate/${'9'.repeat(24)}`) {
      return json({ success: true, data: { _id: '9'.repeat(24), status: 'completed', entities: ['orders'] } });
    }
    if (path === '/unified/requests') {
      return json({ success: true, data: [
        { _id: '5'.repeat(24), method: 'GET', entityType: 'orders', statusCode: 200, success: true },
        { _id: '6'.repeat(24), method: 'POST', entityType: 'products', statusCode: 200, success: true }
      ] });
    }
    if (path === '/unified/rate-limits') {
      return json({ success: true, data: [{ _id: '7'.repeat(24), requestsPerMinute: 120, enabled: true }] });
    }
    if (path.startsWith(`/unified/${'0'.repeat(24)}/`)) {
      return json({ success: false, message: 'Account not found', code: 'NOT_FOUND' }, 404);
    }
    return json({ success: false, message: `mock: no route for ${method} ${path}` }, 404);
  }) as typeof fetch;
}

main().catch(err => {
  console.error('\nGuide failed:', err);
  process.exit(1);
});
