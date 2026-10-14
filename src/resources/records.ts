/**
 * Records resource — the heart of the Unified API. Read and write
 * normalized entity records (`products`, `orders`, `customers`, ...)
 * for any connected account, regardless of the integration behind it.
 *
 * @module
 */

import type { HttpClient, QueryValue } from '../http.js';
import type {
  GetUnifiedRecordsQuery,
  ObjectId,
  PostUnifiedRecordQuery,
  PutUnifiedRecordQuery,
  LightspeedKWebhookState,
  RegisterLightspeedKWebhookRequest,
  ApiResponse,
  RequestOptions,
  UnifiedRecordsPage,
  UnifiedWriteResult
} from '../types.js';

/**
 * Read and write unified records.
 *
 * Accessed via {@link LinkToAny.records | `client.records`}.
 *
 * @category Resources
 */
export class RecordsResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * Read a page of unified records for an entity from a connected
   * account. The integration's native response is normalized into the
   * unified schema defined by the entity's contract — the same shape for
   * every integration.
   *
   * @typeParam T - Shape of a unified record (defaults to a generic object).
   * @param accountId - Connected account to read from.
   * @param entityType - Unified entity type (e.g. `products`, `orders`).
   * @param query - Pagination cursor, page size, `since`, the time filters
   *   (`createdAfter`, `createdBefore`, `updatedAfter`, `updatedBefore`) and any
   *   filter the entity declares (`status`, `active`, `menuId`, …). Each filter is
   *   its own query parameter and any combination is allowed.
   *
   * @example
   * ```ts
   * const page = await client.records.list(accountId, 'products', {
   *   pageSize: 100,
   *   updatedAfter: '2026-01-01T00:00:00Z'
   * });
   * // filtersApplied tells you whether the platform honoured each filter
   * // ('native') or could not ('unavailable' — no effect, never emulated).
   * console.log(page.data.length, page.filtersApplied, page.pagination?.cursor);
   * ```
   */
  list<T = Record<string, unknown>>(
    accountId: ObjectId,
    entityType: string,
    query: GetUnifiedRecordsQuery = {},
    options?: RequestOptions
  ): Promise<UnifiedRecordsPage<T>> {
    return this.http.request({
      method: 'GET',
      path: `/unified/${encodeURIComponent(accountId)}/${encodeURIComponent(entityType)}`,
      query: query as Record<string, QueryValue>,
      options
    });
  }

  /**
   * Iterate over ALL unified records for an entity, transparently
   * following the pagination cursor. Yields one record at a time.
   *
   * @typeParam T - Shape of a unified record.
   * @param accountId - Connected account to read from.
   * @param entityType - Unified entity type.
   * @param query - Initial query; `cursor` is managed internally.
   *
   * @example
   * ```ts
   * for await (const product of client.records.iterate(accountId, 'products')) {
   *   console.log(product);
   * }
   * ```
   */
  async *iterate<T = Record<string, unknown>>(
    accountId: ObjectId,
    entityType: string,
    query: Omit<GetUnifiedRecordsQuery, 'cursor'> = {},
    options?: RequestOptions
  ): AsyncGenerator<T, void, undefined> {
    let cursor: string | undefined;

    do {
      const page = await this.list<T>(
        accountId,
        entityType,
        { ...query, ...(cursor ? { cursor } : {}) },
        options
      );
      for (const record of page.data) {
        yield record;
      }
      const next = page.pagination?.cursor ?? undefined;
      const hasMore = page.pagination?.hasMore ?? Boolean(next);
      cursor = hasMore && next && next !== cursor ? next : undefined;
    } while (cursor);
  }

  /**
   * Iterate page by page instead of record by record. The last page yielded
   * carries `pagination.syncToken` (for systems with native incremental
   * support) — persist it and pass it as `since` next time to read only what
   * changed. A replay that finds nothing yields one empty page whose token
   * equals the one you sent; store it anyway. Check `syncSupport` on the
   * first page before depending on incremental reads — `since` is rejected
   * with `422 INCREMENTAL_SYNC_NOT_SUPPORTED` where it is `'none'`.
   *
   * @example
   * ```ts
   * let syncToken = await store.get(accountId, 'invoice'); // string | undefined
   * for await (const page of client.records.iteratePages(accountId, 'invoice', { since: syncToken, pageSize: 200 })) {
   *   await upsert(page.data);                       // idempotent on externalId
   *   syncToken = page.pagination?.syncToken ?? syncToken;
   * }
   * await store.set(accountId, 'invoice', syncToken);
   * ```
   */
  async *iteratePages<T = Record<string, unknown>>(
    accountId: ObjectId,
    entityType: string,
    query: Omit<GetUnifiedRecordsQuery, 'cursor'> = {},
    options?: RequestOptions
  ): AsyncGenerator<UnifiedRecordsPage<T>, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await this.list<T>(
        accountId,
        entityType,
        { ...query, ...(cursor ? { cursor } : {}) },
        options
      );
      yield page;
      const next = page.pagination?.cursor ?? undefined;
      const hasMore = page.pagination?.hasMore ?? Boolean(next);
      cursor = hasMore && next && next !== cursor ? next : undefined;
    } while (cursor);
  }

  /**
   * Write a unified record to a connected account. The payload is
   * validated against the entity's unified schema, transformed into the
   * integration's native shape and pushed — write once, deliver to any
   * integration.
   *
   * Throws a `ValidationError` (HTTP 422) when the write partially or
   * fully fails downstream.
   *
   * @param accountId - Connected account to write to.
   * @param entityType - Unified entity type.
   * @param record - Record in the unified schema.
   * @param query - Optional Unified API instance scoping.
   *
   * @example
   * ```ts
   * await client.records.create(accountId, 'products', {
   *   name: 'Espresso Beans 1kg',
   *   sku: 'ESP-1KG',
   *   price: 18.5
   * });
   * ```
   */
  create(
    accountId: ObjectId,
    entityType: string,
    record: Record<string, unknown>,
    query: PostUnifiedRecordQuery = {},
    options?: RequestOptions
  ): Promise<UnifiedWriteResult> {
    return this.http.request({
      method: 'POST',
      path: `/unified/${encodeURIComponent(accountId)}/${encodeURIComponent(entityType)}`,
      query: query as Record<string, QueryValue>,
      body: record,
      options
    });
  }

  /**
   * Update one record the connected platform already has. `id` is the record's
   * identifier in that platform (the `externalId` a read returned); the body is
   * the same unified shape {@link create} accepts and is validated and
   * transformed the same way.
   *
   * Update support is per entity and per platform. Where the platform has no
   * update operation configured the call is `409 RUNTIME_PUSH_CONFIG_NOT_FOUND`;
   * an entity the platform does not expose at all is `422 ENTITY_UNSUPPORTED`.
   * A downstream rejection is a `ValidationError` (422) carrying the platform's
   * message.
   *
   * @param accountId - Connected account to write to.
   * @param entityType - Unified entity type.
   * @param id - The record's identifier in the connected platform.
   * @param record - Record in the unified schema.
   * @param query - Optional Unified API instance scoping.
   *
   * @example
   * ```ts
   * await client.records.update(accountId, 'products', 'prd_8812', {
   *   externalId: 'prd_8812',
   *   price: 19.5
   * });
   * ```
   */
  /**
   * Lightspeed K-Series only. The POS confirms order and payment writes through a
   * webhook endpoint registered per connected account; this reports whether the
   * account has one. Any other system answers `422 LIGHTSPEED_K_ONLY`.
   */
  lightspeedKWebhook(accountId: ObjectId, options?: RequestOptions): Promise<ApiResponse<LightspeedKWebhookState>> {
    return this.http.request({ method: 'GET', path: `/unified/${encodeURIComponent(accountId)}/lightspeed-k/webhook`, options });
  }

  /**
   * Lightspeed K-Series only. Register the account's webhook endpoint. Without a body the
   * defaults apply and an already registered account is left as it is; pass `endpointId`
   * and/or an https `url` to register (or re-register) with your own values. `502
   * LIGHTSPEED_ENDPOINT_REGISTRATION_FAILED` when Lightspeed refused it.
   */
  registerLightspeedKWebhook(accountId: ObjectId, body: RegisterLightspeedKWebhookRequest = {}, options?: RequestOptions): Promise<ApiResponse<LightspeedKWebhookState>> {
    return this.http.request({ method: 'POST', path: `/unified/${encodeURIComponent(accountId)}/lightspeed-k/webhook`, body, options });
  }

  update(
    accountId: ObjectId,
    entityType: string,
    id: string,
    record: Record<string, unknown>,
    query: PutUnifiedRecordQuery = {},
    options?: RequestOptions
  ): Promise<UnifiedWriteResult> {
    return this.http.request({
      method: 'PUT',
      path: `/unified/${encodeURIComponent(accountId)}/${encodeURIComponent(entityType)}/${encodeURIComponent(id)}`,
      query: query as Record<string, QueryValue>,
      body: record,
      options
    });
  }
}
