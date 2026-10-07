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
- `ConnectAccountRequest` documents `successUrl` / `failureUrl` (`returnUrl` deprecated) and the
  direct-auth payload rule; `ConnectAccountErrorBody` types `missingFields` /
  `availableApplications` on a refused connect.

### Errors
- `ConflictError` for HTTP 409 (`UNIFIED_SYNC_TOKEN_MISMATCH`, `UNIFIED_CURSOR_FILTER_MISMATCH`).

## 0.3.0

- Rebrand as `@linktoany/sdk` (`LinkToAny` client).
