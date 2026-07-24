/**
 * The Uniflow Unified API client entry point.
 *
 * @module
 */

import { HttpClient } from './http.js';
import { AccountsResource } from './resources/accounts.js';
import { AuthResource } from './resources/auth.js';
import { DocsResource } from './resources/docs.js';
import { EntitiesResource } from './resources/entities.js';
import { InstancesResource } from './resources/instances.js';
import { IntegrationsResource } from './resources/integrations.js';
import { RateLimitsResource } from './resources/rate-limits.js';
import { RecordsResource } from './resources/records.js';
import { RequestsResource } from './resources/requests.js';
import { TemplatesResource } from './resources/templates.js';
import type { RequestOptions, UniflowClientOptions } from './types.js';

/**
 * Client for the LinkToAny Uniflow **Unified API** — one API for every
 * integration. Connect an account once, then read and write normalized
 * entities (`products`, `orders`, `customers`, ...) through the same
 * endpoints regardless of the platform behind them.
 *
 * The typical flow:
 * 1. {@link docs | `client.docs`} / {@link integrations | `client.integrations`} — discover what you can integrate.
 * 2. {@link auth | `client.auth`} — connect a merchant's account.
 * 3. {@link records | `client.records`} — read and write unified records.
 *
 * Selecting `environment: 'dev'` targets the staging deployment at
 * `https://api.staging.linktoany.com`; `'prod'` (the default) targets
 * `https://api.linktoany.com`.
 *
 * @example
 * ```ts
 * import { UniflowClient } from 'unified-api-sdk';
 *
 * const client = new UniflowClient({
 *   apiKey: process.env.UNIFLOW_API_KEY!,
 *   environment: 'dev',
 *   organisationId: 'org-789'
 * });
 *
 * // 1. Connect an account to an integration
 * const conn = await client.auth.connectAccount(systemId, 'shopify', {
 *   merchantId: 'merchant-1',
 *   shop: 'my-store.myshopify.com'
 * });
 *
 * // 2. Read unified records — same shape for every integration
 * const products = await client.records.list(accountId, 'products', {
 *   pageSize: 100
 * });
 * ```
 *
 * @category Client
 */
export class UniflowClient {
  /** @internal */
  private readonly http: HttpClient;

  /** Connect accounts to integrations (OAuth and direct auth flows). */
  readonly auth: AuthResource;
  /** Connected accounts — the merchant-level links every record call runs through. */
  readonly accounts: AccountsResource;
  /** Read and write unified records — the core of the Unified API. */
  readonly records: RecordsResource;
  /** Unified entity contracts and AI contract generation. */
  readonly entities: EntitiesResource;
  /** Vertical templates that bootstrap a Unified API. */
  readonly templates: TemplatesResource;
  /** Your tenant's Unified API instance. */
  readonly instances: InstancesResource;
  /** Audit trail of Unified API requests. */
  readonly requests: RequestsResource;
  /** Catalogue of integrations and their read/write operations. */
  readonly integrations: IntegrationsResource;
  /** Aggregated integration documentation pulled from the platform DB. */
  readonly docs: DocsResource;
  /** Unified API rate-limit configuration. */
  readonly rateLimits: RateLimitsResource;

  /**
   * Create a client.
   *
   * @param options - API key, environment and defaults.
   * @throws Error when `apiKey` is empty or `environment` is invalid.
   */
  constructor(options: UniflowClientOptions) {
    this.http = new HttpClient(options);
    this.auth = new AuthResource(this.http);
    this.accounts = new AccountsResource(this.http);
    this.records = new RecordsResource(this.http);
    this.entities = new EntitiesResource(this.http);
    this.templates = new TemplatesResource(this.http);
    this.instances = new InstancesResource(this.http);
    this.requests = new RequestsResource(this.http);
    this.integrations = new IntegrationsResource(this.http);
    this.docs = new DocsResource(this.integrations, this.entities);
    this.rateLimits = new RateLimitsResource(this.http);
  }

  /** The base URL this client sends requests to. */
  get baseUrl(): string {
    return this.http.resolvedBaseUrl;
  }

  /**
   * Ping the Unified API health endpoint.
   *
   * @returns Service metadata including status and version.
   */
  health(options?: RequestOptions): Promise<{
    status: string;
    service: string;
    timestamp: string;
    version: string;
  }> {
    return this.http.request({ method: 'GET', path: '/health', options });
  }
}
