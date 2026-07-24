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
  RequestOptions,
  UnifiedApiInstance,
  UnifiedInstanceGenerateRequest
} from '../types.js';

/**
 * Manage your Unified API instance.
 *
 * Accessed via {@link UniflowClient.instances | `client.instances`}.
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
