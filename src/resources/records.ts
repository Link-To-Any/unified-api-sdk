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
   * @param query - Pagination cursor, page size, watermark and filters.
   *
   * @example
   * ```ts
   * const page = await client.records.list(accountId, 'products', {
   *   pageSize: 100,
   *   filters: { updatedAfter: '2026-01-01T00:00:00Z' }
   * });
   * console.log(page.data.length, page.pagination?.cursor);
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
