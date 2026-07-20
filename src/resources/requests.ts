/**
 * Requests resource — the audit trail of every Unified API call, for
 * observability and debugging.
 *
 * @module
 */

import type { HttpClient, QueryValue } from '../http.js';
import type {
  ApiResponse,
  ListUnifiedRequestsQuery,
  ObjectId,
  RequestOptions,
  UnifiedApiRequestLog
} from '../types.js';

/**
 * Inspect logged Unified API requests.
 *
 * Accessed via {@link UniflowClient.requests | `client.requests`}.
 *
 * @category Resources
 */
export class RequestsResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * List logged Unified API requests — filter by account, entity,
   * success, status code, time window and more.
   *
   * @example
   * ```ts
   * const failed = await client.requests.list({ accountId, success: false });
   * ```
   */
  list(
    query: ListUnifiedRequestsQuery = {},
    options?: RequestOptions
  ): Promise<ApiResponse<UnifiedApiRequestLog[]>> {
    return this.http.request({
      method: 'GET',
      path: '/api/unified/requests',
      query: query as Record<string, QueryValue>,
      options
    });
  }

  /** Fetch a single logged request with full detail. */
  get(requestId: ObjectId, options?: RequestOptions): Promise<ApiResponse<UnifiedApiRequestLog>> {
    return this.http.request({
      method: 'GET',
      path: `/api/unified/requests/${encodeURIComponent(requestId)}`,
      options
    });
  }
}
