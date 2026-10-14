# Changelog

## 0.4.0 — unreleased

Additive; no breaking changes. Matches link-engine-service `feat/filter-incemental-sync-changes`
and the account-connect changes that followed it.

### Reads
- Time filters are top-level query fields on `records.list` / `iterate` / `iteratePages`:
  `createdAfter`, `createdBefore`, `updatedAfter`, `updatedBefore` (RFC 3339, any combination).
  The nested `filters: {…}` object is deprecated but still sent as `filters[name]`.
- `since` (RFC 3339 instant or a `pagination.syncToken`) for incremental reads; `watermark`
  remains an alias.
- `records.iteratePages()` yields whole pages so the final page's `pagination.syncToken` is
  easy to keep.
- Response typings: `filtersApplied: AppliedFilter[]` (`native` | `unavailable`),
  `syncSupport: 'native' | 'none'`, `pagination.syncToken`.
- `UnifiedReadErrorCode` union for the codes a read can fail with.
- `docs.describeIntegration` / `getEntityFilters` derive filters from the contract's native
  `filterMapping` and expose `syncSupport` per entity.

### Accounts
- `auth.getLinkRequirements(systemId)` → `{ mode, application, requiredFields, availableApplications }`
  so callers know whether an integration redirects (OAuth) or takes credentials, and which
  `application` slug and payload fields to use.
- `auth.createConnectLink(systemId, { successUrl, clientCredentialId?, shopDomain? })` → a
  shareable, expiring connect link (`POST /account/create-link-url`). For Square, Clover,
  Lightspeed and Shopify it goes through LinkToAny's own OAuth callback — the redirect URI
  registered with the provider — where `connectAccount`'s URL uses the credential set's own
  callback and is rejected as an invalid redirect URI unless that is registered too.
  Types `CreateConnectLinkRequest`, `ConnectLink`.
- `auth.getStatus(accountId)` now composes `GET /account/:id` and `GET /account/:id/token-status`
  and returns `{ accountId, status, hasToken, needsRefresh, isAuthenticated, merchantId, systemId,
  lastAuthAt }`. The previous `/oauth/status/:id` route is not served under the public API host
  (404), so the old call never worked there.
- `accounts.listBySystem(systemId, query?)` now filters the list endpoint (`GET /account?systemId=`).
  It used to call `/account/system/:id`, which is the integrations route and returns the system
  document, so the SDK always yielded an empty list. `ListAccountsQuery` gains `merchantId`,
  `status` and `type`.
- `integrations.listAll(query?)` walks the paged catalogue (`list` returns 10 by default, `limit`
  caps at 100) and returns every integration.
- `instances.listSystems()` → the integrations the caller's instance (its chosen vertical)
  supports, each with per-entity read/write capability, filters, sync support and connected
  accounts (`GET /unified/instance/systems`). This is the list to show merchants; the catalogue
  (`integrations.list` / `listAll`) is the whole platform. Types `InstanceSystems`,
  `InstanceSystem`, `InstanceSystemEntitySupport`, `InstanceSystemAccount`.
- `ConnectAccountRequest` documents `successUrl` / `failureUrl` (`returnUrl` deprecated) and the
  direct-auth payload rule; `ConnectAccountErrorBody` types `missingFields` /
  `availableApplications` on a refused connect.

### Examples
- `examples/connect-square.ts`: two-step Square (OAuth) connect — mint the authorization URL,
  then verify the connected account by `accountId`.

### Errors
- `ConflictError` for HTTP 409 (`UNIFIED_SYNC_TOKEN_MISMATCH`, `UNIFIED_CURSOR_FILTER_MISMATCH`).

## 0.3.0

- Rebrand as `@linktoany/sdk` (`LinkToAny` client).
