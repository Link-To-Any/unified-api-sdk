/**
 * Public request / response types for the LinkToAny Unified API.
 *
 * These mirror the server-side Zod validation schemas so the SDK
 * catches shape errors at compile time.
 *
 * @module
 */

/** Target environment for the client. */
export type LinkToAnyEnvironment = 'dev' | 'prod';

/** MongoDB ObjectId as a 24-char hex string. */
export type ObjectId = string;

/** Standard envelope returned by every LinkToAny endpoint. */
export interface ApiResponse<T> {
  success: boolean;
  message?: string;
  data: T;
}

// ---------------------------------------------------------------------------
// Client configuration
// ---------------------------------------------------------------------------

/**
 * Options accepted by {@link LinkToAny}.
 */
export interface LinkToAnyOptions {
  /**
   * API key sent as the `Authorization: Bearer <key>` header.
   * Use an admin key for write operations, public key for read-only.
   */
  apiKey: string;
  /**
   * Which environment to target.
   *
   * - `'dev'`  → `https://api.staging.linktoany.com`
   * - `'prod'` → `https://api.linktoany.com`
   *
   * @defaultValue `'prod'`
   */
  environment?: LinkToAnyEnvironment;
  /**
   * Override the computed base URL entirely (e.g. `http://localhost:3000`
   * for local development). Takes precedence over `environment`.
   */
  baseUrl?: string;
  /** Organisation / tenant id, sent as `x-posx-organisation-id`. */
  organisationId?: string;
  /** Acting user id, sent as `x-posx-user-id`. */
  userId?: string;
  /** Client application id, sent as `x-posx-application-id`. */
  applicationId?: string;
  /**
   * Per-request timeout in milliseconds.
   * @defaultValue `30000`
   */
  timeoutMs?: number;
  /**
   * Max automatic retries for transient failures (429, 502, 503, 504,
   * network errors). Uses exponential backoff and honours `Retry-After`.
   * @defaultValue `2`
   */
  maxRetries?: number;
  /** Extra headers merged into every request. */
  defaultHeaders?: Record<string, string>;
  /** Custom `fetch` implementation (for testing or polyfills). */
  fetch?: typeof fetch;
}

/** Per-call overrides accepted by every SDK method. */
export interface RequestOptions {
  /** Override the client-level timeout for this call. */
  timeoutMs?: number;
  /** Override the client-level retry count for this call. */
  maxRetries?: number;
  /** Extra headers for this call only. */
  headers?: Record<string, string>;
  /** Abort the request externally. */
  signal?: AbortSignal;
}

// ---------------------------------------------------------------------------
// Auth / account connection
// ---------------------------------------------------------------------------

/**
 * Payload for {@link AuthResource.connectAccount}. Contents depend on the
 * integration's auth type — OAuth integrations typically need merchant
 * identifiers (e.g. `shop` for Shopify), direct-auth integrations need
 * credentials.
 */
export interface ConnectAccountRequest {
  /** Merchant identifier in your platform. */
  merchantId?: string;
  /** URL the user is redirected back to after completing OAuth. */
  returnUrl?: string;
  /** Integration-specific fields (e.g. `shop`, `apiKey`, `username`...). */
  [key: string]: unknown;
}

/** Token bundle stored on a connected account. */
export interface TokenInfo {
  accessToken?: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  expiresAt?: string;
  scope?: string;
}

/** Result of starting an account connection. */
export interface ConnectAccountResponse {
  success: boolean;
  message: string;
  systemId: ObjectId;
  application: string;
  data: {
    /** `'oauth'` — redirect the user to `authUrl`. `'direct'` — done. */
    authType: 'oauth' | 'direct';
    /** OAuth authorization URL to redirect the user to (OAuth flows). */
    authUrl?: string;
    /** Callback URL registered for the flow (OAuth flows). */
    callbackUrl?: string;
    /** Newly created account id (direct flows). */
    accountId?: ObjectId;
    /** Merchant id the account was linked to (direct flows). */
    merchantId?: string;
    /** Tokens ready to use (direct flows). */
    tokenInfo?: TokenInfo;
    /** Human-readable next step. */
    instructions?: string;
  };
}

/** Authentication status of an account. */
export interface AuthStatus {
  accountId: ObjectId;
  status: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

/**
 * A connected account — one merchant's authorized link to an
 * integration. Its `_id` is the `accountId` you pass to every unified
 * record call.
 */
export interface Account {
  _id: ObjectId;
  name?: string;
  systemId: ObjectId;
  application?: string;
  merchantId?: string;
  type?: string;
  userId?: string;
  organisationId?: string;
  externalAccountId?: string;
  externalAccountInfo?: Record<string, unknown>;
  tokenInfo?: TokenInfo;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Body for creating an account. */
export interface CreateAccountRequest {
  name: string;
  systemId: ObjectId;
  application?: string;
  type?: string;
  merchantId?: string;
  externalAccountId?: string;
  externalAccountInfo?: Record<string, unknown>;
  [key: string]: unknown;
}

/** Query params for listing accounts. */
export interface ListAccountsQuery {
  page?: number;
  limit?: number;
  systemId?: ObjectId;
  type?: string;
  [key: string]: string | number | boolean | undefined;
}

// ---------------------------------------------------------------------------
// Unified records (execution API)
// ---------------------------------------------------------------------------

/** Query params for reading unified records. */
export interface GetUnifiedRecordsQuery {
  /** Scope the read to a specific unified API instance. */
  unifiedApiId?: ObjectId;
  /** Select a specific read mapping by key. */
  mappingKey?: string;
  /** Opaque pagination cursor from a previous page. */
  cursor?: string;
  /** Page size, max 1000. */
  pageSize?: number;
  /** Incremental-sync watermark (e.g. an updated-at timestamp). */
  watermark?: string;
  /** Entity-specific filters, mapped through the contract's filter mapping. */
  filters?: Record<string, string>;
}

/** Pagination info returned with unified reads. */
export interface UnifiedPagination {
  cursor?: string | null;
  hasMore?: boolean;
  pageSize?: number;
  [key: string]: unknown;
}

/** Result of a unified read. */
export interface UnifiedRecordsPage<T = Record<string, unknown>> {
  success: boolean;
  data: T[];
  pagination?: UnifiedPagination;
}

/** Query params for writing unified records. */
export interface PostUnifiedRecordQuery {
  /** Scope the write to a specific unified API instance. */
  unifiedApiId?: ObjectId;
}

/** Result of a unified write. */
export interface UnifiedWriteResult {
  success: boolean;
  data: unknown;
}

// ---------------------------------------------------------------------------
// Unified contracts
// ---------------------------------------------------------------------------

/** Maps a unified query param onto a system request-template key. */
export interface UnifiedFilterMapping {
  unifiedParam: string;
  templateKey: string;
  valueMapping?: Record<string, string>;
  omitIfEmpty?: boolean;
}

/** Read (sync) mapping inside a unified entity contract. */
export interface ReadMapping {
  key: string;
  systemId: ObjectId;
  sourceEntityType: string;
  syncRequestConfigId?: ObjectId;
  transformationRuleId?: ObjectId;
  enabled?: boolean;
  filterMapping?: UnifiedFilterMapping[];
}

/** Write (push) mapping inside a unified entity contract. */
export interface WriteMapping {
  key: string;
  systemId: ObjectId;
  targetEntityType: string;
  pushRequestConfigId?: ObjectId;
  transformationRuleId?: ObjectId;
  enabled?: boolean;
}

/** A unified entity contract (schema + mappings). */
export interface UnifiedContract {
  _id?: ObjectId;
  entityType: string;
  unifiedZodSchema: string;
  readMappings: ReadMapping[];
  writeMappings: WriteMapping[];
  unifiedApiId?: ObjectId;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Body for creating / replacing a contract. */
export interface UpsertUnifiedContractRequest {
  /** Zod schema source describing the unified entity shape. */
  unifiedZodSchema: string;
  readMappings?: ReadMapping[];
  writeMappings?: WriteMapping[];
}

/** Query for listing contracts. */
export interface ListUnifiedContractsQuery {
  unifiedApiId?: ObjectId;
  entityType?: string;
  /** Filter to contracts covering these integrations. */
  systemIds?: ObjectId[];
  onlyEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// AI generation
// ---------------------------------------------------------------------------

/** Read mapping required for generation (config id mandatory). */
export interface GenerationReadMapping extends ReadMapping {
  syncRequestConfigId: ObjectId;
}

/** Write mapping required for generation (config id mandatory). */
export interface GenerationWriteMapping extends WriteMapping {
  pushRequestConfigId: ObjectId;
}

/** Manual entity grouping for contract generation. */
export interface GenerationEntity {
  entityType: string;
  notes?: string;
  readMappings?: GenerationReadMapping[];
  writeMappings?: GenerationWriteMapping[];
}

/** Body for {@link EntitiesResource.generate | `entities.generate`}. */
export interface GenerateUnifiedContractsRequest {
  unifiedApiId?: ObjectId;
  vertical?: string;
  skipTemplateReuse?: boolean;
  systemIds: ObjectId[];
  /** Mode 1 — manual entity grouping. */
  entities?: GenerationEntity[];
  /** Mode 2 — auto-discovery: AI groups these configs into entities. */
  syncRequestConfigIds?: ObjectId[];
  /** Mode 2 — auto-discovery: AI groups these configs into entities. */
  pushRequestConfigIds?: ObjectId[];
  aiProvider?: string;
  aiModel?: string;
  notes?: string;
  validateWithSamples?: boolean;
  /** 1–5, default 3. */
  maxSchemaGenerationAttempts?: number;
  /** 1–5, default 3. */
  maxRuleGenerationAttempts?: number;
}

/** An async contract-generation task. */
export interface GenerationTask {
  _id: ObjectId;
  status: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Templates & instances
// ---------------------------------------------------------------------------

/** Per-system binding inside a vertical template entity. */
export interface TemplateSystemBinding {
  systemId: ObjectId;
  syncRequestConfigId?: ObjectId;
  syncJsonata?: string;
  pushRequestConfigId?: ObjectId;
  pushJsonata?: string;
}

/** Entity definition inside a vertical template. */
export interface TemplateEntity {
  entityType: string;
  description?: string;
  unifiedZodSchema: string;
  systemBindings: TemplateSystemBinding[];
}

/** Body for creating a vertical template. */
export interface CreateUnifiedTemplateRequest {
  /** Vertical key (e.g. `retail`, `hospitality`). Lower-cased server-side. */
  vertical: string;
  name?: string;
  description?: string;
  systemIds: ObjectId[];
  entities: TemplateEntity[];
}

/** A stored vertical template. */
export interface UnifiedVerticalTemplate extends CreateUnifiedTemplateRequest {
  _id: ObjectId;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** System selection inside an instance entity. */
export interface InstanceSystemSelection {
  systemId: ObjectId;
  syncRequestConfigId?: ObjectId;
  pushRequestConfigId?: ObjectId;
}

/** Entity selection when creating an instance. */
export interface InstanceEntitySelection {
  entityType: string;
  description?: string;
  systems: InstanceSystemSelection[];
}

/** Body for creating a unified API instance. */
export interface CreateUnifiedInstanceRequest {
  vertical: string;
  name?: string;
  description?: string;
  systemIds: ObjectId[];
  entities: InstanceEntitySelection[];
  aiProvider?: string;
  aiModel?: string;
  notes?: string;
  validateWithSamples?: boolean;
  maxSchemaGenerationAttempts?: number;
  maxRuleGenerationAttempts?: number;
}

/** A unified API instance. */
export interface UnifiedApiInstance {
  _id: ObjectId;
  vertical?: string;
  name?: string;
  systemIds?: ObjectId[];
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Body for generating contracts scoped to an instance. */
export interface UnifiedInstanceGenerateRequest {
  systemIds: ObjectId[];
  entities: GenerationEntity[];
  aiProvider?: string;
  aiModel?: string;
  notes?: string;
  validateWithSamples?: boolean;
  maxSchemaGenerationAttempts?: number;
  maxRuleGenerationAttempts?: number;
}

// ---------------------------------------------------------------------------
// Request logs
// ---------------------------------------------------------------------------

/** Query for listing unified API request logs. */
export interface ListUnifiedRequestsQuery {
  accountId?: ObjectId;
  unifiedApiId?: ObjectId;
  contractId?: ObjectId;
  entityType?: string;
  method?: 'GET' | 'POST';
  success?: boolean;
  statusCode?: number;
  errorCode?: string;
  mappingKey?: string;
  systemId?: ObjectId;
  /** ISO datetime lower bound. */
  from?: string;
  /** ISO datetime upper bound. */
  to?: string;
  page?: number;
  /** Max 200, default 50. */
  limit?: number;
  includeRequestBody?: boolean;
  includeExecutionDetails?: boolean;
}

/** A logged unified API request. */
export interface UnifiedApiRequestLog {
  _id: ObjectId;
  accountId?: ObjectId;
  entityType?: string;
  method?: string;
  statusCode?: number;
  success?: boolean;
  createdAt?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Rate limits
// ---------------------------------------------------------------------------

/**
 * Body for creating / updating a rate-limit config.
 * Omit `organisationId` for the global default; omit `accountId` for an
 * org-level config.
 */
export interface UpsertRateLimitRequest {
  organisationId?: string;
  accountId?: ObjectId;
  requestsPerMinute: number;
  enabled?: boolean;
  note?: string;
}

/** A stored unified rate-limit config. */
export interface RateLimitConfig extends UpsertRateLimitRequest {
  _id: ObjectId;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Integrations (the platforms behind the Unified API)
// ---------------------------------------------------------------------------

/** Auth types an integration can support. */
export type IntegrationAuthType =
  | 'noauth'
  | 'oauth2'
  | 'oauth1'
  | 'basic'
  | 'bearer'
  | 'apikey'
  | 'digest'
  | 'hawkauth'
  | 'awsv4'
  | 'ntlm'
  | 'jwt';

/**
 * A platform you can integrate through the Unified API (Shopify,
 * QuickBooks, Lightspeed, ...). Identified by `_id` — the `systemId`
 * you pass when connecting accounts or discovering documentation.
 */
export interface Integration {
  _id: ObjectId;
  name: string;
  description?: string;
  supportedAuthTypes?: IntegrationAuthType[];
  oauthType?: string;
  authFlowType?: 'standard' | 'business_location';
  baseUrl?: string;
  status?: 'active' | 'inactive';
  applicationId?: string;
  applicationSlug?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

/** Query params for listing integrations. */
export interface ListIntegrationsQuery {
  page?: number;
  limit?: number;
  status?: 'active' | 'inactive';
  name?: string;
  [key: string]: string | number | boolean | undefined;
}

/** Option of an enum-typed unified filter. */
export interface AvailableFilterOption {
  label: string;
  value: string;
}

/**
 * A filter supported when reading a unified entity from an integration.
 * `paramName` is what you pass in `filters` on
 * {@link RecordsResource.list | `records.list`} (via the entity
 * contract's filter mapping).
 */
export interface AvailableFilter {
  /** Filter key accepted by the Unified API. */
  paramName: string;
  /** Human-readable label. */
  label: string;
  type: 'string' | 'enum' | 'date' | 'boolean' | 'number';
  /** Allowed values for `enum` filters. */
  options?: AvailableFilterOption[];
  required?: boolean;
  defaultValue?: string;
  description?: string;
}

/**
 * A read operation an integration exposes for an entity — the source
 * behind unified GETs, including the filters it supports.
 */
export interface ReadOperation {
  _id: ObjectId;
  systemId: ObjectId;
  entityType: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  environment?: string;
  /** Filters this read operation supports — the entity's read documentation. */
  availableFilters?: AvailableFilter[];
  [key: string]: unknown;
}

/** Query for listing read operations. */
export interface ListReadOperationsQuery {
  systemId?: ObjectId;
  entityType?: string;
  environment?: string;
}

/**
 * A write operation an integration exposes for an entity — the target
 * behind unified POSTs.
 */
export interface WriteOperation {
  _id: ObjectId;
  systemId?: ObjectId;
  entityType?: string;
  action?: string;
  name?: string;
  description?: string;
  enabled?: boolean;
  [key: string]: unknown;
}

/** Query for listing write operations. */
export interface ListWriteOperationsQuery {
  systemId?: ObjectId;
  entityType?: string;
  action?: string;
}

/** Query for schema template / Zod schema lookups. */
export interface SchemaLookupQuery {
  entityType?: string;
}

// ---------------------------------------------------------------------------
// Documentation aggregate
// ---------------------------------------------------------------------------

/** Unified capabilities discovered for one entity of an integration. */
export interface EntityDocumentation {
  /** Entity type as named by the integration (e.g. `order`). */
  entityType: string;
  /** True when the entity can be read through the Unified API. */
  readable: boolean;
  /** True when the entity can be written through the Unified API. */
  writable: boolean;
  /** Union of available filters across the entity's read operations. */
  filters: AvailableFilter[];
  /** Read operations backing unified GETs for this entity. */
  readOperations: ReadOperation[];
  /** Write operations backing unified POSTs for this entity. */
  writeOperations: WriteOperation[];
  /** Unified entity contracts that map this integration entity, if any. */
  contracts: UnifiedContract[];
}

/**
 * Everything the Unified API knows about an integration, assembled by
 * {@link DocsResource.describeIntegration | `docs.describeIntegration`}.
 */
export interface IntegrationDocumentation {
  /** The integration (name, description, auth types, base URL...). */
  integration: Integration | null;
  /** Entities keyed by capability, with filters and backing operations. */
  entities: EntityDocumentation[];
  /** All read operations of the integration. */
  readOperations: ReadOperation[];
  /** All write operations of the integration. */
  writeOperations: WriteOperation[];
  /** Unified entity contracts referencing the integration. */
  contracts: UnifiedContract[];
  /**
   * Sources that failed while assembling the documentation. Empty when
   * everything loaded. Each entry names the source and the error message.
   */
  warnings: Array<{
    source: 'integration' | 'readOperations' | 'writeOperations' | 'contracts';
    message: string;
  }>;
}
