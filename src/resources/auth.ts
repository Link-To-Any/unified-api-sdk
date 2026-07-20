/**
 * Authentication & account-connection resource.
 *
 * @module
 */

import type { HttpClient } from '../http.js';
import type {
  ApiResponse,
  AuthStatus,
  ConnectAccountRequest,
  ConnectAccountResponse,
  ObjectId,
  RequestOptions,
  TokenInfo
} from '../types.js';

/**
 * Connect accounts to integrations and manage their credentials — the
 * front door of the Unified API: once an account is connected, every
 * entity flows through the same unified endpoints.
 *
 * Accessed via {@link UniflowClient.auth | `client.auth`}.
 *
 * @category Resources
 */
export class AuthResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * Start connecting an account to an integration.
   *
   * For OAuth integrations the response contains `data.authUrl` —
   * redirect the end user there to complete authorization; the Unified
   * API handles the callback and stores the tokens. For direct-auth
   * integrations (api key, basic, bearer) the account is created
   * immediately and the response contains `data.accountId` and
   * `data.tokenInfo` — the `accountId` is what you pass to every
   * unified record call.
   *
   * @param systemId - Id of the integration to connect (e.g. Shopify).
   * @param application - Application slug registered for the integration.
   * @param payload - Integration-specific connection data (merchant id,
   *   credentials, `returnUrl`, ...).
   *
   * @example
   * ```ts
   * const result = await client.auth.connectAccount(systemId, 'shopify', {
   *   merchantId: 'merchant-123',
   *   shop: 'my-store.myshopify.com',
   *   returnUrl: 'https://app.example.com/integrations/done'
   * });
   *
   * if (result.data.authType === 'oauth') {
   *   redirect(result.data.authUrl!);
   * } else {
   *   console.log('Connected account', result.data.accountId);
   * }
   * ```
   */
  connectAccount(
    systemId: ObjectId,
    application: string,
    payload: ConnectAccountRequest = {},
    options?: RequestOptions
  ): Promise<ConnectAccountResponse> {
    return this.http.request({
      method: 'POST',
      path: `/api/account/start/${encodeURIComponent(systemId)}/${encodeURIComponent(application)}`,
      body: payload,
      options
    });
  }

  /**
   * Get the authentication status of an account — use after an OAuth
   * redirect to confirm the connection completed.
   *
   * @param accountId - Id of the account being connected.
   */
  getStatus(accountId: ObjectId, options?: RequestOptions): Promise<ApiResponse<AuthStatus>> {
    return this.http.request({
      method: 'GET',
      path: `/oauth/status/${encodeURIComponent(accountId)}`,
      options
    });
  }

  /**
   * Force-refresh the OAuth tokens of a connected account.
   *
   * Normally unnecessary — the Unified API refreshes tokens
   * automatically before they expire — but useful after a credentials
   * change.
   *
   * @param accountId - Id of the connected account.
   */
  refreshToken(accountId: ObjectId, options?: RequestOptions): Promise<ApiResponse<TokenInfo>> {
    return this.http.request({
      method: 'POST',
      path: `/api/account/${encodeURIComponent(accountId)}/refresh-token`,
      options
    });
  }

  /**
   * Inspect the token health of a connected account (expiry, validity).
   *
   * @param accountId - Id of the connected account.
   */
  getTokenStatus(
    accountId: ObjectId,
    options?: RequestOptions
  ): Promise<ApiResponse<Record<string, unknown>>> {
    return this.http.request({
      method: 'GET',
      path: `/api/account/${encodeURIComponent(accountId)}/token-status`,
      options
    });
  }
}
