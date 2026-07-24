/**
 * Integrations resource — discover the platforms available through the
 * Unified API and the read/write operations each one exposes, straight
 * from the platform database.
 *
 * @module
 */

import type { HttpClient, QueryValue } from '../http.js';
import { normalizeListResponse } from '../normalize.js';
import type {
  ApiResponse,
  Integration,
  IntegrationAuthType,
  ListIntegrationsQuery,
  ListReadOperationsQuery,
  ListWriteOperationsQuery,
  ObjectId,
  ReadOperation,
  RequestOptions,
  SchemaLookupQuery,
  WriteOperation
} from '../types.js';

/**
 * Discover integrations and the operations registered for them.
 *
 * Accessed via {@link UniflowClient.integrations | `client.integrations`}.
 *
 * @category Resources
 */
export class IntegrationsResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  // -------------------------------------------------------------------------
  // Integration catalogue
  // -------------------------------------------------------------------------

  /** List all integrations, optionally filtered and paginated. */
  async list(
    query: ListIntegrationsQuery = {},
    options?: RequestOptions
  ): Promise<ApiResponse<Integration[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: '/account/system',
      query,
      options
    });
    return normalizeListResponse<Integration>(response, 'systems');
  }

  /**
   * Fetch a single integration by its `systemId` — name, description,
   * supported auth types, base URL and connection requirements.
   */
  get(systemId: ObjectId, options?: RequestOptions): Promise<ApiResponse<Integration>> {
    return this.http.request({
      method: 'GET',
      path: `/account/system/${encodeURIComponent(systemId)}`,
      options
    });
  }

  /** Aggregate statistics across all integrations. */
  getStats(options?: RequestOptions): Promise<ApiResponse<Record<string, unknown>>> {
    return this.http.request({ method: 'GET', path: '/account/system/stats', options });
  }

  /** List the auth types the Unified API supports for connecting accounts. */
  getSupportedAuthTypes(options?: RequestOptions): Promise<ApiResponse<IntegrationAuthType[]>> {
    return this.http.request({
      method: 'GET',
      path: '/account/system/supported-auth-types',
      options
    });
  }

  /** List integrations that support a given auth type (e.g. `oauth2`). */
  async listByAuthType(
    authType: IntegrationAuthType,
    options?: RequestOptions
  ): Promise<ApiResponse<Integration[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: `/account/system/auth-type/${encodeURIComponent(authType)}`,
      options
    });
    return normalizeListResponse<Integration>(response, 'systems');
  }

  // -------------------------------------------------------------------------
  // Per-integration operations (from the platform DB)
  // -------------------------------------------------------------------------

  /**
   * List read operations — pass `systemId` to get every entity an
   * integration can serve through unified GETs, including the
   * {@link AvailableFilter | filters} each one supports.
   *
   * @example
   * ```ts
   * const { data } = await client.integrations.listReadOperations({ systemId });
   * for (const op of data) {
   *   console.log(op.entityType, op.availableFilters?.map(f => f.paramName));
   * }
   * ```
   */
  async listReadOperations(
    query: ListReadOperationsQuery = {},
    options?: RequestOptions
  ): Promise<ApiResponse<ReadOperation[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: '/system-integration/sync-configs',
      query: query as Record<string, QueryValue>,
      options
    });
    return normalizeListResponse<ReadOperation>(response, 'configs', 'syncConfigs');
  }

  /**
   * List write operations — pass `systemId` to get every entity an
   * integration accepts through unified POSTs and the actions it
   * supports.
   */
  async listWriteOperations(
    query: ListWriteOperationsQuery = {},
    options?: RequestOptions
  ): Promise<ApiResponse<WriteOperation[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: '/system-integration/configs',
      query: query as Record<string, QueryValue>,
      options
    });
    return normalizeListResponse<WriteOperation>(response, 'configs', 'pushConfigs');
  }

  /** Fetch a single write operation with full detail. */
  getWriteOperation(
    operationId: ObjectId,
    options?: RequestOptions
  ): Promise<ApiResponse<WriteOperation>> {
    return this.http.request({
      method: 'GET',
      path: `/system-integration/configs/${encodeURIComponent(operationId)}`,
      options
    });
  }

  /** Entity schema templates registered on the platform. */
  getSchemaTemplates(
    query: SchemaLookupQuery = {},
    options?: RequestOptions
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return this.http.request({
      method: 'GET',
      path: '/system-integration/schemas/templates',
      query: query as Record<string, QueryValue>,
      options
    });
  }

  /** Zod schema sources for platform entities. */
  getZodSchemas(
    query: SchemaLookupQuery = {},
    options?: RequestOptions
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return this.http.request({
      method: 'GET',
      path: '/system-integration/schemas/zod',
      query: query as Record<string, QueryValue>,
      options
    });
  }
}
