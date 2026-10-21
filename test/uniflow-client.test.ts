/**
 * Unit tests for the LinkToAny SDK.
 *
 * Runs on the built-in Node.js test runner via tsx:
 *   npm test
 *
 * Every test injects a mock `fetch`, so no network access is needed.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  LinkToAny,
  LinkToAnyError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ValidationError,
  ConflictError,
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
  options: Partial<ConstructorParameters<typeof LinkToAny>[0]> = {}
): { client: LinkToAny; calls: RecordedCall[] } {
  const { fetch, calls } = mockFetch(responses);
  const client = new LinkToAny({ apiKey: 'test-key', environment: 'dev', fetch, ...options });
  return { client, calls };
}

// ---------------------------------------------------------------------------
// Construction & base URL resolution
// ---------------------------------------------------------------------------

describe('LinkToAny construction', () => {
  it("resolves 'dev' to the staging base URL", () => {
    const client = new LinkToAny({ apiKey: 'k', environment: 'dev' });
    assert.equal(client.baseUrl, 'https://api.staging.linktoany.com');
  });

  it("resolves 'prod' to the production base URL", () => {
    const client = new LinkToAny({ apiKey: 'k', environment: 'prod' });
    assert.equal(client.baseUrl, 'https://api.linktoany.com');
  });

  it('defaults to prod when environment is omitted', () => {
    const client = new LinkToAny({ apiKey: 'k' });
    assert.equal(client.baseUrl, 'https://api.linktoany.com');
  });

  it('lets baseUrl override the environment and strips trailing slashes', () => {
    const client = new LinkToAny({
      apiKey: 'k',
      environment: 'dev',
      baseUrl: 'http://localhost:3000//'
    });
    assert.equal(client.baseUrl, 'http://localhost:3000');
  });

  it('rejects an empty api key', () => {
    assert.throws(() => new LinkToAny({ apiKey: '  ' }), /apiKey.*required/);
  });

  it('rejects an unknown environment', () => {
    assert.throws(
      () => new LinkToAny({ apiKey: 'k', environment: 'staging' as never }),
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
  it('serializes scalars, the legacy filters object and skips undefined', async () => {
    const { client, calls } = okClient([
      { status: 200, body: { success: true, data: [], pagination: {} } }
    ]);
    await client.records.list(OID_A, 'products', {
      pageSize: 50,
      watermark: undefined,
      filters: { updatedAfter: '2026-01-01T00:00:00Z', createdBefore: '2026-02-01T00:00:00Z' }
    });

    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, `/unified/${OID_A}/products`);
    assert.equal(url.searchParams.get('pageSize'), '50');
    assert.equal(url.searchParams.get('filters[updatedAfter]'), '2026-01-01T00:00:00Z');
    assert.equal(url.searchParams.get('filters[createdBefore]'), '2026-02-01T00:00:00Z');
    assert.ok(!url.searchParams.has('watermark'));
  });

  it('sends each time filter and since as its own query param', async () => {
    const { client, calls } = okClient([
      { status: 200, body: { success: true, data: [], pagination: {} } }
    ]);
    await client.records.list(OID_A, 'order', {
      pageSize: 10,
      since: 'eyJ2IjoyfQ',
      updatedAfter: '2026-01-01T00:00:00Z',
      createdBefore: '2026-02-01T00:00:00Z'
    });

    const url = new URL(calls[0]!.url);
    assert.equal(url.searchParams.get('since'), 'eyJ2IjoyfQ');
    assert.equal(url.searchParams.get('updatedAfter'), '2026-01-01T00:00:00Z');
    assert.equal(url.searchParams.get('createdBefore'), '2026-02-01T00:00:00Z');
    assert.ok(!url.searchParams.has('filters[updatedAfter]'));
    assert.ok(!url.searchParams.has('createdAfter'));
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
  const cases: Array<[number, new (...args: never[]) => LinkToAnyError]> = [
    [401, AuthenticationError],
    [403, PermissionError],
    [404, NotFoundError],
    [409, ConflictError],
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
      await assert.rejects(client.accounts.get(OID_A), (err: LinkToAnyError) => {
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
    const client = new LinkToAny({ apiKey: 'k', fetch: badFetch, maxRetries: 0 });

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

    const client = new LinkToAny({
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

    const client = new LinkToAny({ apiKey: 'k', fetch: neverResolves, maxRetries: 0 });
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
    const client = new LinkToAny({ apiKey: 'k', fetch: failing, maxRetries: 0 });
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

  it('connectAccount for an OAuth integration (Square) sends only the redirect URLs and returns authUrl', async () => {
    const { client, calls } = okClient([
      {
        status: 200,
        body: {
          success: true,
          message: 'Authentication URL generated successfully',
          systemId: OID_A,
          application: 'square',
          data: {
            authType: 'oauth',
            authUrl: 'https://connect.squareup.com/oauth2/authorize?client_id=sq0idp-x&state=abc',
            callbackUrl: 'https://api.staging.linktoany.com/oauth/oauth2/callback/' + OID_A + '/square'
          }
        }
      }
    ]);
    const result = await client.auth.connectAccount(OID_A, 'square', {
      successUrl: 'https://app.example.com/done',
      failureUrl: 'https://app.example.com/failed'
    });

    assert.equal(calls[0]!.method, 'POST');
    assert.ok(calls[0]!.url.endsWith(`/account/start/${OID_A}/square`));
    assert.equal(calls[0]!.headers['authorization'], 'Bearer test-key');
    // No merchantId: Square reports merchant_id at token exchange.
    assert.deepEqual(JSON.parse(calls[0]!.body!), {
      successUrl: 'https://app.example.com/done',
      failureUrl: 'https://app.example.com/failed'
    });
    assert.equal(result.data.authType, 'oauth');
    assert.ok(result.data.authUrl!.startsWith('https://connect.squareup.com/oauth2/authorize'));
    assert.equal(result.data.accountId, undefined);
  });

  it('createConnectLink posts systemId + payload to create-link-url and unwraps data', async () => {
    const link = {
      mode: 'oauth_redirect', authMethod: 'authv2', systemId: OID_A, clientCredentialId: OID_B,
      accountLinkUrl: 'https://platform.staging.linktoany.com/auth/marketplace/account-link/abc',
      expiresAt: '2026-10-16T03:21:41.645Z'
    };
    const { client, calls } = okClient([{ status: 200, body: { success: true, message: 'ok', data: link } }]);
    const result = await client.auth.createConnectLink(OID_A, {
      successUrl: 'https://app.example.com/done',
      clientCredentialId: OID_B
    });

    assert.equal(calls[0]!.method, 'POST');
    assert.ok(calls[0]!.url.endsWith('/account/create-link-url'));
    assert.deepEqual(JSON.parse(calls[0]!.body!), {
      systemId: OID_A,
      successUrl: 'https://app.example.com/done',
      clientCredentialId: OID_B
    });
    assert.deepEqual(result, link);
    if (result.mode === 'oauth_redirect') assert.equal(result.authMethod, 'authv2');
  });

  it('getLinkRequirements asks for the credential sets connectAccount can use and unwraps data', async () => {
    const reqs = {
      systemId: OID_A, systemName: 'Clover US', authType: 'noauth', clientCredentialId: OID_B,
      application: 'clover-us', mode: 'form',
      requiredFields: [{ name: 'personalToken', sourceField: 'personalToken' }, { name: 'merchantId', sourceField: 'merchantId', isUnique: true }],
      availableApplications: [{ application: 'clover-us', authType: 'noauth' }]
    };
    const { client, calls } = okClient([{ status: 200, body: { success: true, message: 'ok', data: reqs } }]);
    const result = await client.auth.getLinkRequirements(OID_A);

    const url = new URL(calls[0]!.url);
    assert.equal(url.pathname, '/account/link-requirements');
    assert.equal(url.searchParams.get('systemId'), OID_A);
    assert.equal(url.searchParams.get('ssoEnabled'), 'false');
    assert.deepEqual(result, reqs);
    assert.equal(result.requiredFields[1]!.isUnique, true);
  });

  it('connectAccount surfaces missingFields on a refused direct-auth connect', async () => {
    const { client } = okClient([
      {
        status: 400,
        body: {
          success: false, message: 'Failed to initiate authentication',
          error: 'Missing required fields for Clover US: personalToken',
          systemId: OID_A, application: 'clover-us', missingFields: ['personalToken']
        }
      }
    ]);
    await assert.rejects(
      client.auth.connectAccount(OID_A, 'clover-us', { merchantId: 'CPPAFM7RS9E51' }),
      (err: ValidationError) => {
        assert.ok(err instanceof ValidationError);
        assert.deepEqual((err.body as { missingFields?: string[] }).missingFields, ['personalToken']);
        return true;
      }
    );
  });

  it('getStatus composes the account record and its token status (no /oauth route on the API host)', async () => {
    const { client, calls } = okClient([
      { status: 200, body: { success: true, data: { _id: OID_A, status: 'active', merchantId: 'MLACVFCAZKCJZ', systemId: { _id: OID_B, name: 'Square' }, lastAuthAt: '2026-10-13T03:35:18.202Z' } } },
      { status: 200, body: { success: true, data: { hasToken: true, needsRefresh: false, status: 'active' } } }
    ]);
    const result = await client.auth.getStatus(OID_A);
    const paths = calls.map(c => new URL(c.url).pathname).sort();
    assert.deepEqual(paths, [`/account/${OID_A}`, `/account/${OID_A}/token-status`]);
    assert.ok(calls.every(c => c.method === 'GET'));
    assert.deepEqual(result.data, {
      accountId: OID_A, status: 'active', hasToken: true, needsRefresh: false, isAuthenticated: true,
      merchantId: 'MLACVFCAZKCJZ', systemId: OID_B, lastAuthAt: '2026-10-13T03:35:18.202Z'
    });
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

describe('integrations.listAll', () => {
  it('walks every page at limit=100 and concatenates', async () => {
    const pageOf = (n: number, start: number) => ({
      status: 200,
      body: { success: true, data: { systems: Array.from({ length: n }, (_, i) => ({ _id: String(start + i).padStart(24, '0'), name: `S${start + i}` })), pagination: { total: 164 } } }
    });
    const { client, calls } = okClient([pageOf(100, 0), pageOf(64, 100)]);
    const all = await client.integrations.listAll({ status: 'active' });

    assert.equal(all.length, 164);
    assert.equal(all[163]!.name, 'S163');
    assert.equal(calls.length, 2);
    for (const [i, call] of calls.entries()) {
      const url = new URL(call.url);
      assert.equal(url.pathname, '/account/system');
      assert.equal(url.searchParams.get('page'), String(i + 1));
      assert.equal(url.searchParams.get('limit'), '100');
      assert.equal(url.searchParams.get('status'), 'active');
    }
  });
});

describe('instances.listSystems', () => {
  it('returns the systems the caller instance supports, unwrapped', async () => {
    const body = {
      success: true,
      data: {
        instanceId: OID_A, vertical: 'restaurant_v3', name: 'My Restaurant V3 Unified API', status: 'active', total: 1,
        systems: [{
          systemId: OID_B, name: 'Square', supportedAuthTypes: ['oauth2'],
          entityTypes: [{ entityType: 'order', read: true, write: false, filters: [], syncSupport: 'none' }],
          accounts: [{ accountId: 'c'.repeat(24), name: 'MLACVFCAZKCJZ account', status: 'active', environment: 'production', type: 'pull', merchantId: 'MLACVFCAZKCJZ' }],
          connectedAccountCount: 1
        }]
      }
    };
    const { client, calls } = okClient([{ status: 200, body }]);
    const result = await client.instances.listSystems();

    assert.equal(calls[0]!.method, 'GET');
    assert.equal(new URL(calls[0]!.url).pathname, '/unified/instance/systems');
    assert.equal(result.vertical, 'restaurant_v3');
    assert.equal(result.systems[0]!.name, 'Square');
    assert.equal(result.systems[0]!.accounts[0]!.merchantId, 'MLACVFCAZKCJZ');
  });
});

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
      'GET /account',
      'GET /account/merchant/m%201'
    ]);
    assert.equal(new URL(calls[1]!.url).searchParams.get('limit'), '10');
    // listBySystem is a systemId filter on the list endpoint — /account/system/:id is the
    // integrations route and returns the system document, not accounts.
    assert.equal(new URL(calls[5]!.url).searchParams.get('systemId'), OID_B);
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

  it('iteratePages yields whole pages and surfaces the final syncToken', async () => {
    const { client, calls } = okClient([
      {
        status: 200,
        body: { success: true, data: [{ n: 1 }], syncSupport: 'native', pagination: { cursor: 'c2', hasMore: true, syncToken: null } }
      },
      {
        status: 200,
        body: { success: true, data: [{ n: 2 }], syncSupport: 'native', pagination: { cursor: null, hasMore: false, syncToken: 'tok-1' } }
      }
    ]);

    let syncToken: string | null | undefined;
    const sizes: number[] = [];
    for await (const page of client.records.iteratePages<{ n: number }>(OID_A, 'order', { since: 'tok-0' })) {
      sizes.push(page.data.length);
      syncToken = page.pagination?.syncToken ?? syncToken;
    }

    assert.deepEqual(sizes, [1, 1]);
    assert.equal(syncToken, 'tok-1');
    assert.equal(calls.length, 2);
    assert.equal(new URL(calls[0]!.url).searchParams.get('since'), 'tok-0');
    assert.equal(new URL(calls[1]!.url).searchParams.get('cursor'), 'c2');
  });

  it('an empty incremental replay still yields the (unchanged) syncToken', async () => {
    const { client } = okClient([
      {
        status: 200,
        body: { success: true, data: [], filtersApplied: [], syncSupport: 'native', pagination: { cursor: null, hasMore: false, syncToken: 'tok-0' } }
      }
    ]);

    const pages = [];
    for await (const page of client.records.iteratePages(OID_A, 'order', { since: 'tok-0' })) pages.push(page);

    assert.equal(pages.length, 1);
    assert.deepEqual(pages[0]!.data, []);
    assert.equal(pages[0]!.pagination?.syncToken, 'tok-0');
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

describe('credentials resource', () => {
  it('lists the organisation\'s sets for one system', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: [{ _id: OID_B, application: 'square-prod', authType: 'oauth2', systemId: OID_A }], total: 1 } }]);
    const res = await client.credentials.list({ systemId: OID_A });
    assert.equal(calls[0]!.method, 'GET');
    const url = new URL(calls[0]!.url);
    assert.ok(url.pathname.endsWith('/unified/client-credentials'));
    assert.equal(url.searchParams.get('systemId'), OID_A);
    assert.equal(url.searchParams.get('systemIds'), null);
    assert.equal(res.data[0]!.application, 'square-prod');
  });

  it('sends several systems comma-separated', async () => {
    const { client, calls } = okClient([{ status: 200, body: { success: true, data: [], total: 0 } }]);
    await client.credentials.list({ systemIds: [OID_A, OID_B] });
    assert.equal(new URL(calls[0]!.url).searchParams.get('systemIds'), `${OID_A},${OID_B}`);
  });
});
