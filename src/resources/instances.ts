/**
 * Instances resource — a Unified API instance is your tenant's own
 * Unified API: the vertical, integrations and entities you selected.
 *
 * @module
 */

import type { HttpClient } from '../http.js';
import type {
  ApiResponse,
  CreateUnifiedInstanceRequest,
  GenerationTask,
  InstanceSystems,
  RequestOptions,
  UnifiedApiInstance,
  UnifiedInstanceGenerateRequest
} from '../types.js';

/**
 * Manage your Unified API instance.
 *
 * Accessed via {@link LinkToAny.instances | `client.instances`}.
 *
 * @category Resources
 */
export class InstancesResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * Create a Unified API instance from a vertical — select entities and
   * integrations; template bindings are reused where available and the
   * rest is AI-generated. Returns 202 with a generation task when async
   * work is needed.
   */
  create(
    body: CreateUnifiedInstanceRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<UnifiedApiInstance & { generationTask?: GenerationTask }>> {
    return this.http.request({ method: 'POST', path: '/unified/instance', body, options });
  }

  /** Fetch your Unified API instance. */
  get(options?: RequestOptions): Promise<ApiResponse<UnifiedApiInstance>> {
    return this.http.request({ method: 'GET', path: '/unified/instance', options });
  }

  /** Generate additional entity contracts scoped to your instance. */
  /**
   * The integrations the caller's current instance supports — scoped to the
   * instance's chosen vertical — each with the entity types it can read or
   * write and the accounts already connected to it.
   *
   * Use this, not {@link IntegrationsResource.listAll | `integrations.listAll`},
   * to decide what to show merchants: the catalogue lists every integration on
   * the platform, this lists the ones your instance actually serves.
   *
   * @example
   * ```ts
   * const { vertical, systems } = await client.instances.listSystems();
   * for (const s of systems) {
   *   console.log(s.name, s.entityTypes.filter(e => e.read).map(e => e.entityType), s.connectedAccountCount);
   * }
   * ```
   */
  async listSystems(options?: RequestOptions): Promise<InstanceSystems> {
    const res = await this.http.request<ApiResponse<InstanceSystems>>({
      method: 'GET',
      path: '/unified/instance/systems',
      options
    });
    return res.data;
  }

  generate(
    body: UnifiedInstanceGenerateRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<GenerationTask>> {
    return this.http.request({
      method: 'POST',
      path: '/unified/instance/generate',
      body,
      options
    });
  }
}
