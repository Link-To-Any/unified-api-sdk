/**
 * Accounts resource — manage connected accounts, the merchant-level
 * links to integrations that every unified record call runs through.
 *
 * @module
 */

import type { HttpClient } from '../http.js';
import { normalizeListResponse } from '../normalize.js';
import type {
  Account,
  ApiResponse,
  CreateAccountRequest,
  ListAccountsQuery,
  ObjectId,
  RequestOptions,
  TokenInfo
} from '../types.js';

/**
 * Manage connected accounts.
 *
 * Accessed via {@link LinkToAny.accounts | `client.accounts`}.
 *
 * @category Resources
 */
export class AccountsResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * Create an account record directly (without an auth flow).
   * Prefer {@link AuthResource.connectAccount} for integrations that
   * require OAuth or credential validation.
   */
  create(body: CreateAccountRequest, options?: RequestOptions): Promise<ApiResponse<Account>> {
    return this.http.request({ method: 'POST', path: '/account', body, options });
  }

  /** List accounts, optionally filtered and paginated. */
  async list(
    query: ListAccountsQuery = {},
    options?: RequestOptions
  ): Promise<ApiResponse<Account[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: '/account',
      query,
      options
    });
    return normalizeListResponse<Account>(response, 'accounts');
  }

  /** Fetch a single account by id. */
  get(accountId: ObjectId, options?: RequestOptions): Promise<ApiResponse<Account>> {
    return this.http.request({
      method: 'GET',
      path: `/account/${encodeURIComponent(accountId)}`,
      options
    });
  }

  /** Update an account by id. */
  update(
    accountId: ObjectId,
    body: Partial<CreateAccountRequest>,
    options?: RequestOptions
  ): Promise<ApiResponse<Account>> {
    return this.http.request({
      method: 'PUT',
      path: `/account/${encodeURIComponent(accountId)}`,
      body,
      options
    });
  }

  /**
   * Delete an account by id. This severs the connection — subsequent
   * unified calls against the account will fail.
   */
  delete(accountId: ObjectId, options?: RequestOptions): Promise<ApiResponse<unknown>> {
    return this.http.request({
      method: 'DELETE',
      path: `/account/${encodeURIComponent(accountId)}`,
      options
    });
  }

  /** List accounts connected to a given integration. */
  async listBySystem(
    systemId: ObjectId,
    options?: RequestOptions
  ): Promise<ApiResponse<Account[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: `/account/system/${encodeURIComponent(systemId)}`,
      options
    });
    return normalizeListResponse<Account>(response, 'accounts');
  }

  /** List all accounts belonging to a merchant. */
  async listByMerchant(
    merchantId: string,
    options?: RequestOptions
  ): Promise<ApiResponse<Account[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: `/account/merchant/${encodeURIComponent(merchantId)}`,
      options
    });
    return normalizeListResponse<Account>(response, 'accounts');
  }

  /**
   * Store or replace the token bundle on an account — for platforms that
   * obtain tokens out-of-band and hand them to LinkToAny.
   */
  updateTokens(
    accountId: ObjectId,
    tokenInfo: TokenInfo,
    externalAccountInfo?: Record<string, unknown>,
    options?: RequestOptions
  ): Promise<ApiResponse<Account>> {
    return this.http.request({
      method: 'PUT',
      path: `/account/${encodeURIComponent(accountId)}/tokens`,
      body: { tokenInfo, ...(externalAccountInfo ? { externalAccountInfo } : {}) },
      options
    });
  }
}
