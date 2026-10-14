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
  ConnectLink,
  CreateConnectLinkRequest,
  LinkRequirements,
  ObjectId,
  RequestOptions,
  TokenInfo
} from '../types.js';

/**
 * Connect accounts to integrations and manage their credentials — the
 * front door of the Unified API: once an account is connected, every
 * entity flows through the same unified endpoints.
 *
 * Accessed via {@link LinkToAny.auth | `client.auth`}.
 *
 * @category Resources
 */
export class AuthResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * What connecting an account to an integration takes — call this before
   * {@link connectAccount} when you don't already know whether the
   * integration redirects (OAuth) or asks the merchant for credentials.
   *
   * `mode: 'oauth_redirect'` → `connectAccount` returns an `authUrl`; the
   * merchant identity is resolved after consent from the provider's redirect
   * or token exchange, so `requiredFields` is informational there.
   * `mode: 'form'` → send every `requiredFields[].sourceField` in the
   * `connectAccount` payload; the account is created immediately.
   * `application` is the slug to pass to `connectAccount`. An integration can
   * have both kinds of credential set (Clover US has an OAuth set and an API
   * token set) — `availableApplications` lists them.
   *
   * Only credential sets that `connectAccount` can use are considered.
   *
   * @param systemId - Id of the integration.
   *
   * @example
   * ```ts
   * const reqs = await client.auth.getLinkRequirements(cloverUs._id);
   * // { mode: 'form', application: 'clover-us', authType: 'noauth',
   * //   requiredFields: [{ sourceField: 'personalToken' }, { sourceField: 'merchantId', isUnique: true }] }
   * ```
   */
  async getLinkRequirements(systemId: ObjectId, options?: RequestOptions): Promise<LinkRequirements> {
    const res = await this.http.request<ApiResponse<LinkRequirements>>({
      method: 'GET',
      path: '/account/link-requirements',
      query: { systemId, ssoEnabled: false },
      options
    });
    return res.data;
  }

  /**
   * Start connecting an account to an integration.
   *
   * For OAuth integrations the response contains `data.authUrl` —
   * redirect the end user there to complete authorization; the Unified
   * API handles the callback, resolves the merchant identity from the
   * provider (Clover's redirect carries `merchant_id`, Square's token
   * exchange does), stores the tokens and sends the merchant to
   * `successUrl` with `?accountId=…&merchantId=<platform merchant id>`.
   * No merchant identifier is needed in the payload. For direct-auth integrations
   * (noauth / api key / basic / bearer) the account is created
   * immediately from the credentials in the payload and the response
   * contains `data.accountId` and `data.tokenInfo` — the `accountId` is
   * what you pass to every unified record call.
   *
   * Direct-auth payload fields are named by
   * {@link getLinkRequirements | `getLinkRequirements(systemId).requiredFields[].sourceField`}.
   * Leaving one out is a `ValidationError` whose `body.missingFields`
   * lists them; a wrong `application` slug is a `ValidationError` whose
   * `body.availableApplications` lists the slugs that exist
   * (see {@link ConnectAccountErrorBody}).
   *
   * @param systemId - Id of the integration to connect (e.g. Shopify).
   * @param application - Credential-set slug registered for the integration
   *   (`getLinkRequirements(systemId).application`).
   * @param payload - Integration-specific connection data (merchant id,
   *   credentials, `successUrl`, ...).
   *
   * @example
   * ```ts
   * // OAuth integration (Square, Clover US OAuth set, Lightspeed K-Series, Shift4, Shopify, …):
   * // nothing to identify the merchant — the provider reports it after consent
   * const result = await client.auth.connectAccount(squareId, 'squareproduction-unified', {
   *   successUrl: 'https://app.example.com/integrations/done',
   *   failureUrl: 'https://app.example.com/integrations/failed'
   * });
   * if (result.data.authType === 'oauth') redirect(result.data.authUrl!);
   *
   * // Direct-auth integration (Clover US API-token set, Clover Asia Pacific, Toast, …): the
   * // merchant's own credentials, named as getLinkRequirements lists them
   * const clover = await client.auth.connectAccount(cloverUsId, 'clover-us', {
   *   merchantId: 'CPPAFM7RS9E51',   // Clover merchant id — also the unique field
   *   personalToken: '0a1b2c3d-…'    // API token from the Clover dashboard
   * });
   * console.log('Connected account', clover.data.accountId);
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
      path: `/account/start/${encodeURIComponent(systemId)}/${encodeURIComponent(application)}`,
      body: payload,
      options
    });
  }

  /**
   * Mint a shareable connect link for an integration — the hosted alternative
   * to {@link connectAccount}. Send the merchant to `accountLinkUrl` (or open
   * it yourself); LinkToAny drives the provider consent screen or a hosted
   * credential form, creates the account, and sends the merchant to
   * `successUrl` with `?accountId=…`.
   *
   * Prefer this over `connectAccount` for Square, Clover, Lightspeed and
   * Shopify: those providers are connected through LinkToAny's own OAuth
   * callback, which is the redirect URI registered with the provider. The
   * `connectAccount` authorization URL uses the credential set's own
   * callback, which the provider rejects as an invalid redirect URI unless
   * it has been registered too.
   *
   * Links expire (`expiresAt`) and create nothing until the merchant
   * completes them, so minting one is side-effect free.
   *
   * @param systemId - Id of the integration to connect.
   * @param payload - `successUrl`, optional `clientCredentialId` to pick a
   *   credential set, `shopDomain` for Shopify.
   *
   * @example
   * ```ts
   * const link = await client.auth.createConnectLink(squareId, {
   *   successUrl: 'https://app.example.com/integrations/done'
   * });
   * // link.mode === 'oauth_redirect' — hand link.accountLinkUrl to the merchant
   * ```
   */
  async createConnectLink(
    systemId: ObjectId,
    payload: CreateConnectLinkRequest = {},
    options?: RequestOptions
  ): Promise<ConnectLink> {
    const res = await this.http.request<ApiResponse<ConnectLink>>({
      method: 'POST',
      path: '/account/create-link-url',
      body: { systemId, ...payload },
      options
    });
    return res.data;
  }

  /**
   * Get the authentication status of an account — use after an OAuth
   * redirect (or once the merchant finished a connect link) to confirm the
   * connection completed.
   *
   * Composed from the account record and its token health, both served under
   * `/account`. (The server's `/oauth/status` route lives outside the public
   * API prefix and is not reachable through the API host.)
   *
   * @param accountId - Id of the account being connected.
   */
  async getStatus(accountId: ObjectId, options?: RequestOptions): Promise<ApiResponse<AuthStatus>> {
    const id = encodeURIComponent(accountId);
    const [account, token] = await Promise.all([
      this.http.request<ApiResponse<Record<string, unknown>>>({ method: 'GET', path: `/account/${id}`, options }),
      this.http.request<ApiResponse<Record<string, unknown>>>({ method: 'GET', path: `/account/${id}/token-status`, options })
    ]);
    const a = account.data ?? {};
    const t = token.data ?? {};
    const systemId = a.systemId as ObjectId | { _id?: ObjectId } | undefined;
    return {
      success: account.success && token.success,
      message: account.message,
      data: {
        accountId: String(a._id ?? accountId),
        status: String(a.status ?? t.status ?? 'unknown'),
        hasToken: Boolean(t.hasToken),
        needsRefresh: Boolean(t.needsRefresh),
        isAuthenticated: Boolean(t.hasToken) && String(a.status ?? '') === 'active',
        merchantId: a.merchantId as string | undefined,
        systemId: typeof systemId === 'object' && systemId ? systemId._id : systemId,
        lastAuthAt: a.lastAuthAt as string | undefined
      }
    };
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
      path: `/account/${encodeURIComponent(accountId)}/refresh-token`,
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
      path: `/account/${encodeURIComponent(accountId)}/token-status`,
      options
    });
  }
}
