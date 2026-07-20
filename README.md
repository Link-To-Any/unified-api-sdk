# @linktoany/uniflow-sdk

Official Node.js / TypeScript SDK for the **LinkToAny Uniflow Unified API** — one API for every integration. Connect a merchant's account once, then read and write normalized entities (`products`, `orders`, `customers`, …) through the same endpoints regardless of the platform behind them.

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
npm install @linktoany/uniflow-sdk
```

## Quick start

```ts
import { UniflowClient } from '@linktoany/uniflow-sdk';

const client = new UniflowClient({
  apiKey: process.env.UNIFLOW_API_KEY!,
  environment: 'dev', // 'dev' → uniflow.staging.linktoany.com, 'prod' → uniflow.linktoany.com
  organisationId: 'org-789'
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
your app ──▶ UniflowClient
              ├─ docs / integrations   what can I integrate? which entities? which filters?
              ├─ auth / accounts       connect merchant accounts (OAuth or direct)
              ├─ records               read/write unified records per accountId + entityType
              ├─ entities              the contracts defining each unified entity
              ├─ templates / instances bootstrap a Unified API per vertical
              └─ requests / rateLimits observability & guardrails
```

### Environments

| `environment` | Base URL |
|---------------|----------|
| `'dev'`       | `https://uniflow.staging.linktoany.com` |
| `'prod'` (default) | `https://uniflow.linktoany.com` |

Override with `baseUrl` for local development:

```ts
new UniflowClient({ apiKey: '…', baseUrl: 'http://localhost:3000' });
```

### Authentication

Every request carries your API key as `x-api-key` plus optional tenant-context headers:

| Client option | Header |
|---------------|--------|
| `apiKey` | `x-api-key` |
| `organisationId` | `x-posx-organisation-id` |
| `userId` | `x-posx-user-id` |
| `applicationId` | `x-posx-application-id` |

Use an **admin** key for write operations, a **public** key for read-only access.

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
// One page
const page = await client.records.list(accountId, 'orders', {
  pageSize: 100,
  filters: { status: 'paid' } // keys from docs.getEntityFilters(...)
});
console.log(page.data, page.pagination?.cursor);

// All pages, cursor handled for you
for await (const order of client.records.iterate(accountId, 'orders')) {
  process(order);
}

// Typed
interface Order { id: string; status: string; total: number }
const { data } = await client.records.list<Order>(accountId, 'orders');
```

## Write unified records (`client.records`)

Write once in the unified schema — validated against the entity contract, transformed to the integration's native shape, pushed:

```ts
await client.records.create(accountId, 'products', {
  name: 'Espresso Beans 1kg',
  sku: 'ESP-1KG',
  price: 18.5
});
```

## Unified entity contracts (`client.entities`)

A contract = an entity's unified Zod schema + mappings onto integration operations:

```ts
const contracts = await client.entities.list({ onlyEnabled: true });

await client.entities.upsert('products', {
  unifiedZodSchema: '…',
  readMappings: [{ key: 'shopify', systemId, sourceEntityType: 'product' }]
});
```

### Generate contracts with AI

```ts
// Auto-discovery: AI groups integration operations into unified entities
const { data: task } = await client.entities.generate({
  systemIds: [systemA, systemB],
  syncRequestConfigIds: [readOp1, readOp2],
  pushRequestConfigIds: [writeOp1]
});

const finished = await client.entities.waitForGeneration(task._id, {
  intervalMs: 5_000,
  timeoutMs: 600_000
});
```

## Templates & instances

```ts
const template = await client.templates.get('retail');   // pre-built vertical

const instance = await client.instances.create({         // your Unified API
  vertical: 'retail',
  systemIds: [shopifyId, quickbooksId],
  entities: [{ entityType: 'products', systems: [{ systemId: shopifyId, syncRequestConfigId }] }]
});
```

## Observability (`client.requests`, `client.rateLimits`)

```ts
const failed = await client.requests.list({ accountId, success: false, limit: 50 });
const detail = await client.requests.get(failed.data[0]._id);

await client.rateLimits.upsert({ organisationId: 'org-789', requestsPerMinute: 120 });
```

## Error handling

All failures throw typed subclasses of `UniflowError`:

```ts
import { RateLimitError, ValidationError, NotFoundError } from '@linktoany/uniflow-sdk';

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
| `RateLimitError` | 429 (after retries exhausted) |
| `ServerError` | 5xx |
| `TimeoutError` / `ConnectionError` | request never completed |

## Timeouts, retries & cancellation

```ts
const client = new UniflowClient({
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
UNIFLOW_API_KEY=... UNIFLOW_SYSTEM_ID=... npx tsx examples/usage-guide.ts
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
