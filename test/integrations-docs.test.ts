/**
 * Tests for the integrations catalogue resource and the DB-backed docs
 * aggregator (`client.systems`, `client.docs`).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { LinkToAny } from '../src/index.js';
import type { AvailableFilter } from '../src/index.js';

const SYSTEM_ID = 'f'.repeat(24);
const OTHER_SYSTEM = 'e'.repeat(24);

interface RecordedCall {
  url: string;
  method: string;
}

/**
 * Mock fetch that routes by URL substring — needed because docs
 * aggregation fires requests in parallel, so replay-in-order mocks
 * would be racy.
 */
function routedFetch(
  routes: Array<{ match: (url: URL) => boolean; status?: number; body: unknown }>
): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url: String(input), method: init?.method ?? 'GET' });
    const route = routes.find(r => r.match(url));
    if (!route) {
      return new Response(JSON.stringify({ success: false, message: `no route for ${url.pathname}` }), {
        status: 404
      });
    }
    return new Response(JSON.stringify(route.body), { status: route.status ?? 200 });
  }) as typeof fetch;
  return { fetch: impl, calls };
}

const FILTER_STATUS: AvailableFilter = {
  paramName: 'orderStatus',
  label: 'Order Status',
  type: 'enum',
  options: [
    { label: 'Paid', value: 'paid' },
    { label: 'Pending', value: 'pending' }
  ]
};

const FILTER_FROM: AvailableFilter = {
  paramName: 'fromDate',
  label: 'From Date',
  type: 'date'
};

function fullSystemRoutes() {
  return routedFetch([
    {
      match: url => url.pathname === `/account/system/${SYSTEM_ID}`,
      body: {
        success: true,
        data: {
          _id: SYSTEM_ID,
          name: 'Shopify',
          description: 'E-commerce platform',
          supportedAuthTypes: ['oauth2'],
          status: 'active'
        }
      }
    },
    {
      match: url => url.pathname === '/system-integration/sync-configs',
      body: {
        success: true,
        data: [
          {
            _id: '1'.repeat(24),
            systemId: SYSTEM_ID,
            entityType: 'Order',
            name: 'Shopify orders sync',
            availableFilters: [FILTER_STATUS, FILTER_FROM]
          },
          {
            _id: '2'.repeat(24),
            systemId: SYSTEM_ID,
            entityType: 'order',
            name: 'Shopify orders sync v2',
            availableFilters: [FILTER_STATUS] // duplicate paramName — must dedupe
          },
          {
            _id: '3'.repeat(24),
            systemId: SYSTEM_ID,
            entityType: 'product',
            name: 'Shopify products sync'
          }
        ],
        count: 3
      }
    },
    {
      match: url => url.pathname === '/system-integration/configs',
      body: {
        success: true,
        data: [
          { _id: '4'.repeat(24), systemId: SYSTEM_ID, entityType: 'product', action: 'create' },
          { _id: '5'.repeat(24), systemId: SYSTEM_ID, entityType: 'customer', action: 'create' }
        ]
      }
    },
    {
      match: url => url.pathname === '/unified',
      body: {
        success: true,
        data: [
          {
            entityType: 'orders',
            unifiedZodSchema: 'z.object({})',
            readMappings: [
              { key: 'shopify', systemId: SYSTEM_ID, sourceEntityType: 'order' },
              { key: 'other', systemId: OTHER_SYSTEM, sourceEntityType: 'order' }
            ],
            writeMappings: []
          }
        ]
      }
    }
  ]);
}

// ---------------------------------------------------------------------------
// Systems resource
// ---------------------------------------------------------------------------

describe('integrations resource', () => {
  it('hits the expected endpoints', async () => {
    const { fetch, calls } = routedFetch([
      { match: () => true, body: { success: true, data: [] } }
    ]);
    const client = new LinkToAny({ apiKey: 'k', environment: 'dev', fetch });

    await client.integrations.list({ status: 'active' });
    await client.integrations.get(SYSTEM_ID);
    await client.integrations.getStats();
    await client.integrations.getSupportedAuthTypes();
    await client.integrations.listByAuthType('oauth2');
    await client.integrations.listReadOperations({ systemId: SYSTEM_ID, entityType: 'order' });
    await client.integrations.listWriteOperations({ systemId: SYSTEM_ID, action: 'create' });
    await client.integrations.getWriteOperation('9'.repeat(24));
    await client.integrations.getSchemaTemplates({ entityType: 'order' });
    await client.integrations.getZodSchemas();

    const seen = calls.map(c => `${c.method} ${new URL(c.url).pathname}`);
    assert.deepEqual(seen, [
      'GET /account/system',
      `GET /account/system/${SYSTEM_ID}`,
      'GET /account/system/stats',
      'GET /account/system/supported-auth-types',
      'GET /account/system/auth-type/oauth2',
      'GET /system-integration/sync-configs',
      'GET /system-integration/configs',
      `GET /system-integration/configs/${'9'.repeat(24)}`,
      'GET /system-integration/schemas/templates',
      'GET /system-integration/schemas/zod'
    ]);

    assert.equal(new URL(calls[0]!.url).searchParams.get('status'), 'active');
    assert.equal(new URL(calls[5]!.url).searchParams.get('systemId'), SYSTEM_ID);
    assert.equal(new URL(calls[5]!.url).searchParams.get('entityType'), 'order');
    assert.equal(new URL(calls[6]!.url).searchParams.get('action'), 'create');
    assert.equal(new URL(calls[8]!.url).searchParams.get('entityType'), 'order');
  });
});

// ---------------------------------------------------------------------------
// Docs aggregator
// ---------------------------------------------------------------------------

describe('docs.describeIntegration', () => {
  it('assembles system, entities, filters and contracts', async () => {
    const { fetch, calls } = fullSystemRoutes();
    const client = new LinkToAny({ apiKey: 'k', environment: 'dev', fetch });

    const docs = await client.docs.describeIntegration(SYSTEM_ID);

    // All four sources fetched, in parallel, scoped to the system
    assert.equal(calls.length, 4);
    const contractsCall = calls.find(c => new URL(c.url).pathname === '/unified');
    assert.equal(new URL(contractsCall!.url).searchParams.get('systemIds'), SYSTEM_ID);

    assert.equal(docs.integration?.name, 'Shopify');
    assert.equal(docs.warnings.length, 0);
    assert.equal(docs.readOperations.length, 3);
    assert.equal(docs.writeOperations.length, 2);
    assert.equal(docs.contracts.length, 1);

    // Entities merged case-insensitively and sorted
    assert.deepEqual(docs.entities.map(e => e.entityType), ['customer', 'order', 'product']);

    const order = docs.entities.find(e => e.entityType === 'order')!;
    assert.equal(order.readable, true);
    assert.equal(order.writable, false);
    assert.equal(order.readOperations.length, 2); // 'Order' + 'order' merged
    // Filters deduped by paramName across both configs
    assert.deepEqual(order.filters.map(f => f.paramName).sort(), ['fromDate', 'orderStatus']);
    // Contract attached via readMapping sourceEntityType, only for this system
    assert.equal(order.contracts.length, 1);
    assert.equal(order.contracts[0]!.entityType, 'orders');

    const product = docs.entities.find(e => e.entityType === 'product')!;
    assert.equal(product.readable, true);
    assert.equal(product.writable, true);
    assert.deepEqual(product.filters, []);

    const customer = docs.entities.find(e => e.entityType === 'customer')!;
    assert.equal(customer.readable, false);
    assert.equal(customer.writable, true);
  });

  it('reports failing sources as warnings instead of failing the call', async () => {
    const { fetch } = routedFetch([
      {
        match: url => url.pathname === `/account/system/${SYSTEM_ID}`,
        body: { success: true, data: { _id: SYSTEM_ID, name: 'Shopify' } }
      },
      {
        match: url => url.pathname === '/system-integration/sync-configs',
        status: 500,
        body: { success: false, message: 'sync configs exploded' }
      },
      {
        match: url => url.pathname === '/system-integration/configs',
        body: { success: true, data: [{ _id: '4'.repeat(24), entityType: 'product', action: 'create' }] }
      },
      {
        match: url => url.pathname === '/unified',
        body: { success: true, data: [] }
      }
    ]);
    const client = new LinkToAny({ apiKey: 'k', environment: 'dev', fetch, maxRetries: 0 });

    const docs = await client.docs.describeIntegration(SYSTEM_ID);

    assert.equal(docs.integration?.name, 'Shopify');
    assert.deepEqual(docs.readOperations, []);
    assert.equal(docs.writeOperations.length, 1);
    assert.equal(docs.warnings.length, 1);
    assert.equal(docs.warnings[0]!.source, 'readOperations');
    assert.match(docs.warnings[0]!.message, /sync configs exploded/);

    // product still documented from the surviving push configs
    const product = docs.entities.find(e => e.entityType === 'product')!;
    assert.equal(product.writable, true);
    assert.equal(product.readable, false);
  });
});

describe('docs helpers', () => {
  it('listEntities returns the entity view only', async () => {
    const { fetch } = fullSystemRoutes();
    const client = new LinkToAny({ apiKey: 'k', environment: 'dev', fetch });

    const entities = await client.docs.listEntities(SYSTEM_ID);
    assert.deepEqual(entities.map(e => e.entityType), ['customer', 'order', 'product']);
  });

  it('getEntityFilters queries scoped sync configs and dedupes', async () => {
    const { fetch, calls } = routedFetch([
      {
        match: url => url.pathname === '/system-integration/sync-configs',
        body: {
          success: true,
          data: [
            { _id: '1'.repeat(24), entityType: 'order', availableFilters: [FILTER_STATUS] },
            { _id: '2'.repeat(24), entityType: 'order', availableFilters: [FILTER_STATUS, FILTER_FROM] }
          ]
        }
      }
    ]);
    const client = new LinkToAny({ apiKey: 'k', environment: 'dev', fetch });

    const filters = await client.docs.getEntityFilters(SYSTEM_ID, 'order');

    const url = new URL(calls[0]!.url);
    assert.equal(url.searchParams.get('systemId'), SYSTEM_ID);
    assert.equal(url.searchParams.get('entityType'), 'order');
    assert.deepEqual(filters.map(f => f.paramName).sort(), ['fromDate', 'orderStatus']);
    assert.deepEqual(filters.find(f => f.paramName === 'orderStatus')?.options?.map(o => o.value), [
      'paid',
      'pending'
    ]);
  });

  it('describeAllIntegrations documents every catalogued system', async () => {
    const { fetch, calls } = routedFetch([
      {
        match: url => url.pathname === '/account/system',
        body: {
          success: true,
          data: [
            { _id: SYSTEM_ID, name: 'Shopify' },
            { _id: OTHER_SYSTEM, name: 'QuickBooks' }
          ]
        }
      },
      { match: url => url.pathname.startsWith('/account/system/'), body: { success: true, data: { name: 'x' } } },
      { match: () => true, body: { success: true, data: [] } }
    ]);
    const client = new LinkToAny({ apiKey: 'k', environment: 'dev', fetch });

    const all = await client.docs.describeAllIntegrations();
    assert.equal(all.length, 2);
    // 1 list + 2 systems × 4 sources
    assert.equal(calls.length, 9);
  });
});
