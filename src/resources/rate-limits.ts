/**
 * Unified API rate-limit configuration resource.
 *
 * @module
 */

import type { HttpClient } from '../http.js';
import { normalizeListResponse } from '../normalize.js';
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
 * NOTE: admin-plane routes — may not be exposed on the public API
 * gateway (404), depending on deployment.
 *
 * Accessed via {@link UniflowClient.rateLimits | `client.rateLimits`}.
 *
 * @category Resources
 */
export class RateLimitsResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /** List all rate-limit configs. */
  async list(options?: RequestOptions): Promise<ApiResponse<RateLimitConfig[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: '/unified/rate-limits',
      options
    });
    return normalizeListResponse<RateLimitConfig>(response, 'configs', 'rateLimits');
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
    return this.http.request({ method: 'POST', path: '/unified/rate-limits', body, options });
  }

  /** Delete a rate-limit config by id. */
  delete(configId: ObjectId, options?: RequestOptions): Promise<ApiResponse<unknown>> {
    return this.http.request({
      method: 'DELETE',
      path: `/unified/rate-limits/${encodeURIComponent(configId)}`,
      options
    });
  }
}
