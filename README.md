# @linktoany/sdk

Official Node.js / TypeScript SDK for the **LinkToAny Unified API** — one API for every integration. Connect a merchant's account once, then read and write normalized entities (`products`, `orders`, `customers`, …) through the same endpoints regardless of the platform behind them.

- Zero runtime dependencies (built on native `fetch`, Node.js ≥ 18)
- Unified-API-centric surface: `records`, `entities`, `integrations`, `docs`, `auth`, `accounts`
- Fully typed request/response models mirroring the server's validation schemas
- Automatic retries with exponential backoff (`429`, `502`, `503`, `504`, network errors) honouring `Retry-After`
- Typed error hierarchy (`AuthenticationError`, `ValidationError`, `RateLimitError`, …)
- Cursor pagination helper (`records.iterate`) and generation-task polling (`entities.waitForGeneration`)
- Ships CJS + ESM builds with full `.d.ts` types; API reference auto-generated with TypeDoc
- **Runnable usage guide**: `npx tsx examples/usage-guide.ts` (works offline in mock mode)

## Installation

```bash
npm install @linktoany/sdk
```

## Quick start

```ts
import { LinkToAny } from '@linktoany/sdk';

const client = new LinkToAny({
  apiKey: process.env.LINKTOANY_API_KEY!,
  environment: 'dev' // 'dev' → api.staging.linktoany.com, 'prod' → api.linktoany.com
});

// 1. Connect a merchant's account to an integration
const conn = await client.auth.connectAccount(systemId, 'shopify', {
  merchantId: 'merchant-1',
  shop: 'my-store.myshopify.com'
});

// 2. Read unified records — same call, same shape, every integration
const orders = await client.records.list(accountId, 'orders', { pageSize: 100 });
```

### The Unified API in one picture

```
your app ──▶ LinkToAny
              ├─ docs / integrations   what can I integrate? which entities? which filters?
              ├─ auth / accounts       connect merchant accounts (OAuth or direct)
              ├─ records               read/write unified records per accountId + entityType
              ├─ entities              the contracts defining each unified entity
              └─ requests / rateLimits observability & guardrails
```

### Environments

| `environment` | Base URL |
|---------------|----------|
| `'dev'`       | `https://api.staging.linktoany.com` |
| `'prod'` (default) | `https://api.linktoany.com` |

Override with `baseUrl` for local development:

```ts
new LinkToAny({ apiKey: '…', baseUrl: 'http://localhost:3000' });
```

### Authentication

Every request carries your API key as `Authorization: Bearer <key>`:

| Client option | Header |
|---------------|--------|
| `apiKey` | `Authorization: Bearer <key>` |

Use an **api** key for write operations and read-only access.

## Discover integrations (`client.docs`, `client.integrations`)

Pull everything the Unified API knows about an integration — entities, read/write capability, filters, contracts — straight from the platform database:

```ts
const docs = await client.docs.describeIntegration(systemId);

console.log(docs.integration?.name, docs.integration?.supportedAuthTypes);
for (const entity of docs.entities) {
  console.log(
    entity.entityType,                      // 'order'
    entity.readable, entity.writable,      // capabilities
    entity.filters.map(f => f.paramName)   // filters usable in records.list
  );
}
// A failing source never fails the call — check docs.warnings
```

Focused helpers:

```ts
await client.docs.listEntities(systemId);                 // entity capabilities only
await client.docs.getEntityFilters(systemId, 'order');    // filters for one entity
await client.docs.describeAllIntegrations();              // whole catalogue
```

Raw resources:

```ts
await client.integrations.list({ status: 'active' });     // catalogue
await client.integrations.get(systemId);                  // one integration
await client.integrations.getSupportedAuthTypes();        // auth types
await client.integrations.listByAuthType('oauth2');       // filter by auth
await client.integrations.listReadOperations({ systemId });   // unified GET sources
await client.integrations.listWriteOperations({ systemId });  // unified POST targets
await client.integrations.getSchemaTemplates({ entityType: 'order' });
await client.integrations.getZodSchemas({ entityType: 'order' });
```

## Connect an account (`client.auth`)

OAuth integrations return an authorization URL to redirect the user to; direct-auth integrations (API key / basic / bearer) connect immediately:

```ts
const result = await client.auth.connectAccount(systemId, 'shopify', {
  merchantId: 'merchant-123',
  shop: 'my-store.myshopify.com',
  returnUrl: 'https://app.example.com/integrations/done'
});

if (result.data.authType === 'oauth') {
  redirect(result.data.authUrl!); // Unified API handles callback + token storage
} else {
  console.log('Connected:', result.data.accountId);
}

await client.auth.getStatus(accountId);       // confirm after redirect
await client.auth.getTokenStatus(accountId);  // token health
await client.auth.refreshToken(accountId);    // force refresh (normally automatic)
```

Manage connected accounts with `client.accounts` — `create`, `list`, `get`, `update`, `delete`, `listBySystem`, `listByMerchant`, `updateTokens`.

## Read unified records (`client.records`)

```ts
// One page, with a time filter. Each filter is its own query param and any
// combination of createdAfter / createdBefore / updatedAfter / updatedBefore is allowed.
const page = await client.records.list(accountId, 'order', {
  pageSize: 100,
  updatedAfter: '2026-01-01T00:00:00Z'
});
console.log(page.data, page.pagination?.cursor);

// filtersApplied says what the platform did with each filter:
//   [{ name: 'updatedAfter', mode: 'native' }]       — applied by the platform
//   [{ name: 'createdAfter', mode: 'unavailable' }]  — this system can't; no effect, never emulated
// Which filters each system supports is listed per entity in the API reference,
// or read it at runtime with client.docs.getEntityFilters(systemId, 'order').
console.log(page.filtersApplied, page.syncSupport);

// All pages, cursor handled for you
for await (const order of client.records.iterate(accountId, 'order')) {
  process(order);
}

// Typed
interface Order { externalId: string; state: string; total: number }
const { data } = await client.records.list<Order>(accountId, 'order');
```

Values are RFC 3339; the SDK never needs a platform-specific format — LinkToAny converts to
epoch milliseconds for Clover, ISO for Square, and so on.

### Incremental reads (`since` / `syncToken`)

Where `syncSupport` is `'native'`, the final page of a read (`hasMore: false`) carries
`pagination.syncToken`. Store it and pass it back as `since` to receive only what changed:

```ts
let syncToken = await store.get(accountId, 'order'); // string | undefined on first run

for await (const page of client.records.iteratePages(accountId, 'order', { since: syncToken, pageSize: 200 })) {
  await upsert(page.data);                           // idempotent on externalId
  syncToken = page.pagination?.syncToken ?? syncToken;
}

await store.set(accountId, 'order', syncToken);
```

- `since` also accepts a raw RFC 3339 instant (`'2026-03-01T00:00:00Z'`). Anything else is
  `422 INVALID_SINCE_VALUE`.
- The checkpoint advances to the newest record seen. A replay that finds nothing returns one empty
  page with the **same** token — keep storing whatever comes back.
- Delivery is at-least-once: the record on the boundary may appear again. Upsert, don't insert.
- A token pins the filters of the read that produced it; different filters with the same token are
  `409 UNIFIED_CURSOR_FILTER_MISMATCH`, another account/entity is `409 UNIFIED_SYNC_TOKEN_MISMATCH`.
  `updatedAfter` sent alongside `since` is fine — the later bound wins.
- On systems where `syncSupport` is `'none'`, `since` is `422 INCREMENTAL_SYNC_NOT_SUPPORTED` rather
  than a silent full read. Deletes are not reported yet.

## Write unified records (`client.records`)

Write once in the unified schema — validated against the entity contract, transformed to the integration's native shape, pushed:

```ts
await client.records.create(accountId, 'products', {
  name: 'Espresso Beans 1kg',
  sku: 'ESP-1KG',
  price: 18.5
});
```

## Observability (`client.requests`, `client.rateLimits`)

```ts
const failed = await client.requests.list({ accountId, success: false, limit: 50 });
const detail = await client.requests.get(failed.data[0]._id);

await client.rateLimits.upsert({ organisationId: 'org-789', requestsPerMinute: 120 });
```

## Error handling

All failures throw typed subclasses of `LinkToAnyError`:

```ts
import { RateLimitError, ValidationError, NotFoundError } from '@linktoany/sdk';

try {
  await client.records.create(accountId, 'products', payload);
} catch (err) {
  if (err instanceof ValidationError) console.error('Bad payload:', err.body);
  else if (err instanceof RateLimitError) console.error(`Retry in ${err.retryAfterSeconds}s`);
  else if (err instanceof NotFoundError) console.error('Unknown account or entity');
  else throw err;
}
```

| Error | HTTP status |
|-------|-------------|
| `AuthenticationError` | 401 |
| `PermissionError` | 403 |
| `NotFoundError` | 404 |
| `ValidationError` | 400 / 422 |
| `ConflictError` | 409 (cursor / sync token issued for a different read) |
| `RateLimitError` | 429 (after retries exhausted) |
| `ServerError` | 5xx |
| `TimeoutError` / `ConnectionError` | request never completed |

Every error carries `code` (typed for unified reads as `UnifiedReadErrorCode`), `body` and
`requestId`. Codes a read can fail with:

| `code` | Error | Meaning |
|--------|-------|---------|
| `UNKNOWN_FILTER` | `ValidationError` | Filter name outside `createdAfter` / `createdBefore` / `updatedAfter` / `updatedBefore` |
| `INVALID_FILTER_VALUE` | `ValidationError` | Filter value is not an RFC 3339 date-time |
| `INVALID_SINCE_VALUE` | `ValidationError` | `since` is neither a date-time nor a `syncToken` (e.g. a page `cursor`) |
| `INCREMENTAL_SYNC_NOT_SUPPORTED` | `ValidationError` | `since` sent where `syncSupport` is `'none'` |
| `UNIFIED_SYNC_TOKEN_MISMATCH` | `ConflictError` | Token from another account, entity or mapping |
| `UNIFIED_CURSOR_FILTER_MISMATCH` | `ConflictError` | Cursor/token pins different filters than those sent |

## Timeouts, retries & cancellation

```ts
const client = new LinkToAny({
  apiKey: '…',
  timeoutMs: 60_000, // default 30 000
  maxRetries: 3      // default 2
});

// Per-call overrides + cancellation
const ac = new AbortController();
await client.records.list(accountId, 'orders', {}, {
  timeoutMs: 10_000,
  maxRetries: 0,
  signal: ac.signal
});
```

## Runnable usage guide

A complete, sectioned walkthrough of every workflow lives at [examples/usage-guide.ts](examples/usage-guide.ts):

```bash
# Mock mode — zero credentials, zero network; see every call and its output
npx tsx examples/usage-guide.ts

# Live mode — against the staging Unified API
LINKTOANY_API_KEY=... LINKTOANY_SYSTEM_ID=... npx tsx examples/usage-guide.ts
```

## API reference (auto-generated docs)

Every public method carries TSDoc; generate a browsable HTML reference with:

```bash
npm run docs   # outputs ./docs via TypeDoc
```

IDE tooltips (VS Code, JetBrains) render the same documentation inline.

## Development

```bash
npm install
npm run typecheck   # strict TS check (src + tests + examples)
npm test            # unit tests (node:test via tsx, mocked fetch — no network)
npm run build       # CJS + ESM + .d.ts into ./dist
npm run docs        # TypeDoc HTML reference into ./docs
```
