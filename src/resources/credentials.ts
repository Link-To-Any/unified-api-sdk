/**
 * Credentials resource — the client-credential sets (your organisation's own apps
 * registered with each platform) that accounts connect through.
 *
 * @module
 */

import type { HttpClient, QueryValue } from '../http.js';
import type { ApiResponse, ClientCredentialSummary, ListClientCredentialsQuery, RequestOptions } from '../types.js';

/**
 * List the credential sets your organisation can connect accounts through.
 *
 * Accessed via {@link LinkToAny.credentials | `client.credentials`}.
 *
 * @category Resources
 */
export class CredentialsResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * Your organisation's credential sets, optionally for one or several systems.
   * Only sets your organisation owns are returned — never shared sets — and never
   * secrets (`authConfig` is not included). Pass a set's `_id` as
   * `clientCredentialId` to {@link AuthResource.connectAccount} or
   * {@link AuthResource.getLinkRequirements} to connect through exactly that set.
   *
   * @example
   * ```ts
   * const { data: sets } = await client.credentials.list({ systemId });
   * if (!sets.length) throw new Error('Add a credential set for this platform first');
   * const result = await client.auth.connectAccount(systemId, sets[0].application, {
   *   clientCredentialId: sets[0]._id,
   *   successUrl: 'https://app.example.com/integrations/done',
   * });
   * ```
   */
  list(query: ListClientCredentialsQuery = {}, options?: RequestOptions): Promise<ApiResponse<ClientCredentialSummary[]>> {
    const { systemIds, ...rest } = query;
    const params: Record<string, QueryValue> = { ...(rest as Record<string, QueryValue>) };
    if (!rest.systemId && systemIds?.length) params.systemIds = systemIds.join(',');
    return this.http.request({
      method: 'GET',
      path: '/unified/client-credentials',
      query: params,
      options
    });
  }
}
