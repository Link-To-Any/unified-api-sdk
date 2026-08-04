/**
 * Templates resource — reusable vertical templates (retail,
 * hospitality, ...) that bootstrap a Unified API with pre-built entity
 * schemas and integration bindings.
 *
 * @module
 */

import type { HttpClient } from '../http.js';
import { normalizeListResponse } from '../normalize.js';
import type {
  ApiResponse,
  CreateUnifiedTemplateRequest,
  RequestOptions,
  UnifiedVerticalTemplate
} from '../types.js';

/**
 * Manage vertical templates.
 *
 * Accessed via {@link LinkToAny.templates | `client.templates`}.
 *
 * @category Resources
 */
export class TemplatesResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /** Create a reusable vertical template (entity schemas + integration bindings). */
  create(
    body: CreateUnifiedTemplateRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<UnifiedVerticalTemplate>> {
    return this.http.request({ method: 'POST', path: '/unified/templates', body, options });
  }

  /** List all vertical templates. */
  async list(options?: RequestOptions): Promise<ApiResponse<UnifiedVerticalTemplate[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: '/unified/templates',
      options
    });
    return normalizeListResponse<UnifiedVerticalTemplate>(response, 'templates');
  }

  /** Fetch the template for a vertical (e.g. `retail`). */
  get(vertical: string, options?: RequestOptions): Promise<ApiResponse<UnifiedVerticalTemplate>> {
    return this.http.request({
      method: 'GET',
      path: `/unified/templates/${encodeURIComponent(vertical)}`,
      options
    });
  }
}
