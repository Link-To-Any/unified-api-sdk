/**
 * Templates resource — reusable vertical templates (retail,
 * hospitality, ...) that bootstrap a Unified API with pre-built entity
 * schemas and integration bindings.
 *
 * @module
 */

import type { HttpClient } from '../http.js';
import type {
  ApiResponse,
  CreateUnifiedTemplateRequest,
  RequestOptions,
  UnifiedVerticalTemplate
} from '../types.js';

/**
 * Manage vertical templates.
 *
 * Accessed via {@link UniflowClient.templates | `client.templates`}.
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
    return this.http.request({ method: 'POST', path: '/api/unified/templates', body, options });
  }

  /** List all vertical templates. */
  list(options?: RequestOptions): Promise<ApiResponse<UnifiedVerticalTemplate[]>> {
    return this.http.request({ method: 'GET', path: '/api/unified/templates', options });
  }

  /** Fetch the template for a vertical (e.g. `retail`). */
  get(vertical: string, options?: RequestOptions): Promise<ApiResponse<UnifiedVerticalTemplate>> {
    return this.http.request({
      method: 'GET',
      path: `/api/unified/templates/${encodeURIComponent(vertical)}`,
      options
    });
  }
}
