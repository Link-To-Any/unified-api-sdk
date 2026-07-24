/**
 * Unit tests for the Uniflow SDK.
 *
 * Runs on the built-in Node.js test runner via tsx:
 *   npm test
 *
 * Every test injects a mock `fetch`, so no network access is needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  UniflowClient,
  UniflowError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ServerError,
  ConnectionError,
  TimeoutError
} from '../src/index.js';

const OID_A = 'a'.repeat(24);
const OID_B = 'b'.repeat(24);

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: string;
}

interface MockResponse {
  status?: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Build a mock fetch that replays `responses` in order (repeating the last
 * one) and records every call.
 */
function mockFetch(responses: MockResponse[]): { fetch: typeof fetch; calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];
  let index = 0;

  const impl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? 'GET',
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === 'string' ? init.body : undefined
    });
    const spec = responses[Math.min(index++, responses.length - 1)] ?? {};
    return new Response(spec.body === undefined ? null : JSON.stringify(spec.body), {
      status: spec.status ?? 200,
      headers: spec.headers ?? {}
    });
  }) as typeof fetch;

  return { fetch: impl, calls };
}

function okClient(
  responses: MockResponse[] = [{ status: 200, body: { success: true, data: {} } }],
  options: Partial<ConstructorParameters<typeof UniflowClient>[0]> = {}
): { client: UniflowClient; calls: RecordedCall[] } {
  const { fetch, calls } = mockFetch(responses);
  const client = new UniflowClient({ apiKey: 'test-key', environment: 'dev', fetch, ...options });
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Construction & base URL resolution
// ---------------------------------------------------------------------------

describe('UniflowClient construction', () => {
  it("resolves 'dev' to the staging base URL", () => {
    const client = new UniflowClient({ apiKey: 'k', environment: 'dev' });
    assert.equal(client.baseUrl, 'https://api.staging.linktoany.com');
  });

  it("resolves 'prod' to the production base URL", () => {
    const client = new UniflowClient({ apiKey: 'k', environment: 'prod' });
    assert.equal(client.baseUrl, 'https://api.linktoany.com');
  });

  it('defaults to prod when environment is omitted', () => {
    const client = new UniflowClient({ apiKey: 'k' });
    assert.equal(client.baseUrl, 'https://api.linktoany.com');
  });

  it('lets baseUrl override the environment and strips trailing slashes', () => {
    const client = new UniflowClient({
      apiKey: 'k',
      environment: 'dev',
      baseUrl: 'http://localhost:3000//'
    });
    assert.equal(client.baseUrl, 'http://localhost:3000');
  });

  it('rejects an empty api key', () => {
    assert.throws(() => new UniflowClient({ apiKey: '  ' }), /apiKey.*required/);
  });

  it('rejects an unknown environment', () => {
    assert.throws(
      () => new UniflowClient({ apiKey: 'k', environment: 'staging' as never }),
      /invalid environment 'staging'/
    );
  });
});

// ---------------------------------------------------------------------------
// Headers & request shaping
// ---------------------------------------------------------------------------

describe('request headers', () => {
  it('sends the api key and posx context headers', async () => {
    const { client, calls } = okClient(undefined, {
      organisationId: 'org-1',
      userId: 'user-1',
      applicationId: 'app-1'
    });
    await client.accounts.get(OID_A);

    const headers = calls[0]!.headers;
    assert.equal(headers['authorization'], 'Bearer test-key');
    assert.equal(headers['x-posx-organisation-id'], 'org-1');
    assert.equal(headers['x-posx-user-id'], 'user-1');
    assert.equal(headers['x-posx-application-id'], 'app-1');
    assert.equal(headers['content-type'], 'application/json');
  });

  it('omits posx headers when context is not configured', async () => {
    const { client, calls } = okClient();
    await client.accounts.get(OID_A);

    const headers = calls[0]!.headers;
    assert.ok(!('x-posx-organisation-id' in headers));
    assert.ok(!('x-posx-user-id' in headers));
  });

  it('merges defaultHeaders and per-call headers, per-call winning', async () => {
    const { client, calls } = okClient(undefined, {
      defaultHeaders: { 'x-custom': 'default', 'x-keep': 'yes' }
    });
    await client.accounts.get(OID_A, { headers: { 'x-custom': 'override' } });

    assert.equal(calls[0]!.headers['x-custom'], 'override');
    assert.equal(calls[0]!.headers['x-keep'], 'yes');
  });
});

describe('query serialization', () => {
  it('serializes scalars, nested filters and skips undefined', async () => {
    const { client, calls } = okClient([
      { status: 200, body: { success: true, data: [], pagination: {} } }
    ]);
    await client.records.list(OID_A, 'products', {
      pageSize: 50,
      watermark: undefined,
      filters: { status: 'active', vendor: 'acme' }
    });

    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, `/unified/${OID_A}/products`);
    assert.equal(url.searchParams.get('pageSize'), '50');
    assert.equal(url.searchParams.get('filters[status]'), 'active');
    assert.equal(url.searchParams.get('filters[vendor]'), 'acme');
    assert.ok(!url.searchParams.has('watermark'));
  });

  it('serializes array params as comma-separated values', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: [] } }]);
    await client.entities.list({ systemIds: [OID_A, OID_B], onlyEnabled: true });

    const url = new URL(calls[0]!.url);
    assert.equal(url.searchParams.get('systemIds'), `${OID_A},${OID_B}`);
    assert.equal(url.searchParams.get('onlyEnabled'), 'true');
  });

  it('URL-encodes path segments', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: [] } }]);
    await client.records.list(OID_A, 'sales orders');
    assert.ok(calls[0]!.url.endsWith(`/unified/${OID_A}/sales%20orders`));
  });
});

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

describe('error mapping', () => {
  const cases: Array<[number, new (...args: never[]) => UniflowError]> = [
    [401, AuthenticationError],
    [403, PermissionError],
    [404, NotFoundError],
    [400, ValidationError],
    [422, ValidationError],
    [500, ServerError]
  ];

  for (const [status, errorClass] of cases) {
    it(`maps HTTP ${status} to ${errorClass.name}`, async () => {
      const { client } = okClient(
        [{ status, body: { success: false, message: 'boom', code: 'E_TEST' } }],
        { maxRetries: 0 }
      );
      await assert.rejects(client.accounts.get(OID_A), (err: UniflowError) => {
        assert.ok(err instanceof errorClass, `expected ${errorClass.name}, got ${err.constructor.name}`);
        assert.equal(err.status, status);
        assert.equal(err.code, 'E_TEST');
        assert.equal(err.message, 'boom');
        assert.ok(err.requestId);
        return true;
      });
    });
  }

  it('exposes the raw body and handles non-JSON error responses', async () => {
    const { fetch } = mockFetch([]);
    const badFetch = (async () =>
      new Response('plain text error', { status: 500 })) as typeof fetch;
    const client = new UniflowClient({ apiKey: 'k', fetch: badFetch, maxRetries: 0 });

    await assert.rejects(client.accounts.get(OID_A), (err: ServerError) => {
      assert.ok(err instanceof ServerError);
      assert.equal(err.message, 'plain text error');
      return true;
    });
    void fetch;
  });
});

// ---------------------------------------------------------------------------
// Retries, timeout, cancellation
// ---------------------------------------------------------------------------

describe('retries', () => {
  it('retries 429 and succeeds', async () => {
    const { client, calls } = okClient(
      [
        { status: 429, body: { message: 'rate limited' }, headers: { 'retry-after': '0' } },
        { status: 200, body: { success: true, data: { _id: OID_A } } }
      ],
      { maxRetries: 2 }
    );
    const result = await client.accounts.get(OID_A);
    assert.equal(calls.length, 2);
    assert.deepEqual(result.data, { _id: OID_A });
  });

  it('throws RateLimitError with retryAfterSeconds once retries are exhausted', async () => {
    const { client, calls } = okClient(
      [{ status: 429, body: { message: 'rl' }, headers: { 'retry-after': '0' } }],
      { maxRetries: 1 }
    );
    await assert.rejects(client.accounts.get(OID_A), (err: RateLimitError) => {
      assert.ok(err instanceof RateLimitError);
      assert.equal(err.retryAfterSeconds, 0);
      return true;
    });
    assert.equal(calls.length, 2); // initial + 1 retry
  });

  it('does not retry non-retryable statuses', async () => {
    const { client, calls } = okClient(
      [{ status: 400, body: { message: 'bad' } }],
      { maxRetries: 3 }
    );
    await assert.rejects(client.accounts.get(OID_A), ValidationError);
    assert.equal(calls.length, 1);
  });

  it('honours per-call maxRetries override', async () => {
    const { client, calls } = okClient(
      [{ status: 503, body: { message: 'down' } }],
      { maxRetries: 5 }
    );
    await assert.rejects(client.accounts.get(OID_A, { maxRetries: 0 }), ServerError);
    assert.equal(calls.length, 1);
  });
});

describe('timeout and cancellation', () => {
  it('throws TimeoutError when the request exceeds timeoutMs', async () => {
    const neverResolves = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      })) as typeof fetch;

    const client = new UniflowClient({
      apiKey: 'k',
      fetch: neverResolves,
      timeoutMs: 30,
      maxRetries: 0
    });
    await assert.rejects(client.health(), TimeoutError);
  });

  it('throws ConnectionError when the caller aborts', async () => {
    const neverResolves = ((_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        );
      })) as typeof fetch;

    const client = new UniflowClient({ apiKey: 'k', fetch: neverResolves, maxRetries: 0 });
    const ac = new AbortController();
    const pending = assert.rejects(
      client.health({ signal: ac.signal }),
      (err: ConnectionError) => {
        assert.ok(err instanceof ConnectionError);
        assert.ok(!(err instanceof TimeoutError));
        return true;
      }
    );
    ac.abort();
    await pending;
  });

  it('wraps network failures in ConnectionError', async () => {
    const failing = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    const client = new UniflowClient({ apiKey: 'k', fetch: failing, maxRetries: 0 });
    await assert.rejects(client.health(), (err: ConnectionError) => {
      assert.ok(err instanceof ConnectionError);
      assert.match(err.message, /fetch failed/);
      return true;
    });
  });
});

// ---------------------------------------------------------------------------
// Auth resource
// ---------------------------------------------------------------------------

describe('auth resource', () => {
  it('connectAccount posts to the start endpoint with the payload', async () => {
    const { client, calls } = okClient([
      {
        status: 200,
        body: {
          success: true,
          message: 'ok',
          systemId: OID_A,
          application: 'shopify',
          data: { authType: 'oauth', authUrl: 'https://auth.example.com' }
        }
      }
    ]);
    const result = await client.auth.connectAccount(OID_A, 'shopify', {
      merchantId: 'm-1',
      shop: 'demo.myshopify.com'
    });

    assert.equal(calls[0]!.method, 'POST');
    assert.ok(calls[0]!.url.endsWith(`/account/start/${OID_A}/shopify`));
    assert.deepEqual(JSON.parse(calls[0]!.body!), {
      merchantId: 'm-1',
      shop: 'demo.myshopify.com'
    });
    assert.equal(result.data.authType, 'oauth');
    assert.equal(result.data.authUrl, 'https://auth.example.com');
  });

  it('getStatus targets the public oauth status endpoint', async () => {
    const { client, calls } = okClient([
      { status: 200, body: { success: true, data: { accountId: OID_A, status: 'authenticated' } } }
    ]);
    await client.auth.getStatus(OID_A);
    assert.ok(calls[0]!.url.endsWith(`/oauth/status/${OID_A}`));
    assert.equal(calls[0]!.method, 'GET');
  });

  it('refreshToken and getTokenStatus hit the account endpoints', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: {} } }]);
    await client.auth.refreshToken(OID_A);
    await client.auth.getTokenStatus(OID_A);

    assert.equal(calls[0]!.method, 'POST');
    assert.ok(calls[0]!.url.endsWith(`/account/${OID_A}/refresh-token`));
    assert.equal(calls[1]!.method, 'GET');
    assert.ok(calls[1]!.url.endsWith(`/account/${OID_A}/token-status`));
  });
});

// ---------------------------------------------------------------------------
// Accounts resource
// ---------------------------------------------------------------------------

describe('accounts resource', () => {
  it('covers CRUD paths and methods', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: {} } }]);

    await client.accounts.create({ name: 'A', systemId: OID_A });
    await client.accounts.list({ page: 1, limit: 10 });
    await client.accounts.get(OID_A);
    await client.accounts.update(OID_A, { name: 'B' });
    await client.accounts.delete(OID_A);
    await client.accounts.listBySystem(OID_B);
    await client.accounts.listByMerchant('m 1');

    const seen = calls.map(c => `${c.method} ${new URL(c.url).pathname}`);
    assert.deepEqual(seen, [
      'POST /account',
      'GET /account',
      `GET /account/${OID_A}`,
      `PUT /account/${OID_A}`,
      `DELETE /account/${OID_A}`,
      `GET /account/system/${OID_B}`,
      'GET /account/merchant/m%201'
    ]);
    assert.equal(new URL(calls[1]!.url).searchParams.get('limit'), '10');
  });

  it('updateTokens wraps tokenInfo and optional externalAccountInfo', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: {} } }]);
    await client.accounts.updateTokens(OID_A, { accessToken: 't' }, { shop: 's' });

    assert.ok(calls[0]!.url.endsWith(`/account/${OID_A}/tokens`));
    assert.deepEqual(JSON.parse(calls[0]!.body!), {
      tokenInfo: { accessToken: 't' },
      externalAccountInfo: { shop: 's' }
    });
  });
});

// ---------------------------------------------------------------------------
// Unified resource
// ---------------------------------------------------------------------------

describe('unified records', () => {
  it('getRecords returns data and pagination', async () => {
    const { client } = okClient([
      {
        status: 200,
        body: { success: true, data: [{ sku: 'X' }], pagination: { cursor: 'c1', hasMore: true } }
      }
    ]);
    const page = await client.records.list<{ sku: string }>(OID_A, 'products');
    assert.equal(page.data[0]!.sku, 'X');
    assert.equal(page.pagination?.cursor, 'c1');
  });

  it('createRecord posts the raw record body', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: [] } }]);
    await client.records.create(OID_A, 'products', { sku: 'NEW' }, { unifiedApiId: OID_B });

    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, `/unified/${OID_A}/products`);
    assert.equal(url.searchParams.get('unifiedApiId'), OID_B);
    assert.deepEqual(JSON.parse(calls[0]!.body!), { sku: 'NEW' });
  });

  it('iterateRecords follows the cursor across pages', async () => {
    const { client, calls } = okClient([
      {
        status: 200,
        body: { success: true, data: [{ n: 1 }, { n: 2 }], pagination: { cursor: 'c2', hasMore: true } }
      },
      {
        status: 200,
        body: { success: true, data: [{ n: 3 }], pagination: { cursor: null, hasMore: false } }
      }
    ]);

    const seen: number[] = [];
    for await (const record of client.records.iterate<{ n: number }>(OID_A, 'orders')) {
      seen.push(record.n);
    }

    assert.deepEqual(seen, [1, 2, 3]);
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[1]!.url).searchParams.get('cursor'), 'c2');
  });

  it('iterateRecords stops when the cursor repeats (no infinite loop)', async () => {
    const { client, calls } = okClient([
      {
        status: 200,
        body: { success: true, data: [{ n: 1 }], pagination: { cursor: 'same', hasMore: true } }
      }
    ]);

    const seen: number[] = [];
    for await (const record of client.records.iterate<{ n: number }>(OID_A, 'orders')) {
      seen.push(record.n);
      if (seen.length > 5) break; // safety net for a regression
    }

    assert.deepEqual(seen, [1, 1]); // first page + one repeat, then stop
    assert.equal(calls.length, 2);
  });
});

describe('unified contracts, templates, instances, logs', () => {
  it('hits the expected endpoints', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: {} } }]);

    await client.entities.upsert('products', { unifiedZodSchema: 'z.object({})' });
    await client.templates.list();
    await client.templates.get('Retail');
    await client.instances.create({
      vertical: 'retail',
      systemIds: [OID_A],
      entities: [{ entityType: 'products', systems: [{ systemId: OID_A, syncRequestConfigId: OID_B }] }]
    });
    await client.instances.get();
    await client.requests.list({ accountId: OID_A, success: false });
    await client.requests.get(OID_B);

    const seen = calls.map(c => `${c.method} ${new URL(c.url).pathname}`);
    assert.deepEqual(seen, [
      'PUT /unified/products',
      'GET /unified/templates',
      'GET /unified/templates/Retail',
      'POST /unified/instance',
      'GET /unified/instance',
      'GET /unified/requests',
      `GET /unified/requests/${OID_B}`
    ]);
    assert.equal(new URL(calls[5]!.url).searchParams.get('success'), 'false');
  });
});

describe('generation tasks', () => {
  it('generateContracts posts and returns the task', async () => {
    const { client, calls } = okClient([
      { status: 202, body: { success: true, data: { _id: OID_B, status: 'pending' } } }
    ]);
    const { data: task } = await client.entities.generate({
      systemIds: [OID_A],
      syncRequestConfigIds: [OID_B]
    });
    assert.ok(calls[0]!.url.endsWith('/unified/generate'));
    assert.equal(task._id, OID_B);
  });

  it('waitForGenerationTask polls until a terminal status', async () => {
    const { client, calls } = okClient([
      { status: 200, body: { success: true, data: { _id: OID_B, status: 'processing' } } },
      { status: 200, body: { success: true, data: { _id: OID_B, status: 'completed' } } }
    ]);
    const task = await client.entities.waitForGeneration(OID_B, { intervalMs: 1 });
    assert.equal(task.status, 'completed');
    assert.equal(calls.length, 2);
  });

  it('waitForGenerationTask throws when the timeout budget runs out', async () => {
    const { client } = okClient([
      { status: 200, body: { success: true, data: { _id: OID_B, status: 'processing' } } }
    ]);
    await assert.rejects(
      client.entities.waitForGeneration(OID_B, { intervalMs: 10, timeoutMs: 5 }),
      /did not complete within 5ms/
    );
  });
});

// ---------------------------------------------------------------------------
// Rate limits resource
// ---------------------------------------------------------------------------

describe('rate limits resource', () => {
  it('lists, upserts and deletes configs', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: {} } }]);

    await client.rateLimits.list();
    await client.rateLimits.upsert({ organisationId: 'org-1', requestsPerMinute: 120 });
    await client.rateLimits.delete(OID_A);

    const seen = calls.map(c => `${c.method} ${new URL(c.url).pathname}`);
    assert.deepEqual(seen, [
      'GET /unified/rate-limits',
      'POST /unified/rate-limits',
      `DELETE /unified/rate-limits/${OID_A}`
    ]);
    assert.deepEqual(JSON.parse(calls[1]!.body!), {
      organisationId: 'org-1',
      requestsPerMinute: 120
    });
  });
});

// ---------------------------------------------------------------------------
// Gateway list-envelope normalization
// ---------------------------------------------------------------------------

describe('list response normalization', () => {
  it('unwraps data.items envelopes (contracts, requests)', async () => {
    const { client } = okClient([
      { status: 200, body: { success: true, data: { items: [{ entityType: 'orders' }], pagination: { total: 1 } } } }
    ]);
    const { data } = await client.entities.list();
    assert.deepEqual(data, [{ entityType: 'orders' }]);
  });

  it('unwraps resource-keyed envelopes (data.systems)', async () => {
    const { client } = okClient([
      { status: 200, body: { success: true, data: { systems: [{ _id: OID_A, name: 'BigCommerce' }] } } }
    ]);
    const { data } = await client.integrations.list();
    assert.equal(data[0]!.name, 'BigCommerce');
  });

  it('passes plain arrays through untouched', async () => {
    const { client } = okClient([
      { status: 200, body: { success: true, data: [{ _id: OID_A }] } }
    ]);
    const { data } = await client.accounts.list();
    assert.deepEqual(data, [{ _id: OID_A }]);
  });

  it('returns empty array for unrecognized envelope shapes', async () => {
    const { client } = okClient([
      { status: 200, body: { success: true, data: { weird: true } } }
    ]);
    const { data } = await client.templates.list();
    assert.deepEqual(data, []);
  });
});
