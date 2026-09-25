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
   * @param query - Pagination cursor, page size, `since` and time filters
   *   (`createdAfter`, `createdBefore`, `updatedAfter`, `updatedBefore`).
   *   Each filter is its own query parameter and any combination is allowed.
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
}
