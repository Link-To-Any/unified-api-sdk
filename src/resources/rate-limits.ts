/**
 * Unified API rate-limit configuration resource.
 *
 * @module
 */

import type { HttpClient } from '../http.js';
import type {
  ApiResponse,
  ObjectId,
  RateLimitConfig,
  RequestOptions,
  UpsertRateLimitRequest
} from '../types.js';

/**
 * Manage per-organisation / per-account unified API rate limits.
 *
 * Accessed via {@link UniflowClient.rateLimits | `client.rateLimits`}.
 *
 * @category Resources
 */
export class RateLimitsResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /** List all rate-limit configs. */
  list(options?: RequestOptions): Promise<ApiResponse<RateLimitConfig[]>> {
    return this.http.request({ method: 'GET', path: '/api/unified/rate-limits', options });
  }

  /**
   * Create or update a rate-limit config.
   *
   * Omit `organisationId` for the global default; omit `accountId` for an
   * organisation-level config.
   */
  upsert(
    body: UpsertRateLimitRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<RateLimitConfig>> {
    return this.http.request({ method: 'POST', path: '/api/unified/rate-limits', body, options });
  }

  /** Delete a rate-limit config by id. */
  delete(configId: ObjectId, options?: RequestOptions): Promise<ApiResponse<unknown>> {
    return this.http.request({
      method: 'DELETE',
      path: `/api/unified/rate-limits/${encodeURIComponent(configId)}`,
      options
    });
  }
}
