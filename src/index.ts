/**
 * @linktoany/sdk — official Node.js / TypeScript SDK for the
 * LinkToAny **Unified API**: one API for every integration.
 *
 * @packageDocumentation
 */

export { LinkToAny } from './client.js';

export { AuthResource } from './resources/auth.js';
export { AccountsResource } from './resources/accounts.js';
export { RecordsResource } from './resources/records.js';
export { EntitiesResource } from './resources/entities.js';
export { TemplatesResource } from './resources/templates.js';
export { InstancesResource } from './resources/instances.js';
export { RequestsResource } from './resources/requests.js';
export { IntegrationsResource } from './resources/integrations.js';
export { DocsResource } from './resources/docs.js';
export { RateLimitsResource } from './resources/rate-limits.js';

export {
  LinkToAnyError,
  AuthenticationError,
  PermissionError,
  NotFoundError,
  ValidationError,
  RateLimitError,
  ServerError,
  ConnectionError,
  TimeoutError
} from './errors.js';
export type { LinkToAnyErrorBody } from './errors.js';

export type {
  // Client config
  LinkToAnyEnvironment,
  LinkToAnyOptions,
  RequestOptions,
  ApiResponse,
  ObjectId,
  // Auth / connection
  ConnectAccountRequest,
  ConnectAccountResponse,
  AuthStatus,
  TokenInfo,
  // Accounts
  Account,
  CreateAccountRequest,
  ListAccountsQuery,
  // Unified records
  GetUnifiedRecordsQuery,
  UnifiedPagination,
  UnifiedRecordsPage,
  PostUnifiedRecordQuery,
  UnifiedWriteResult,
  // Entity contracts
  UnifiedFilterMapping,
  ReadMapping,
  WriteMapping,
  UnifiedContract,
  UpsertUnifiedContractRequest,
  ListUnifiedContractsQuery,
  // Generation
  GenerationReadMapping,
  GenerationWriteMapping,
  GenerationEntity,
  GenerateUnifiedContractsRequest,
  GenerationTask,
  // Templates & instances
  TemplateSystemBinding,
  TemplateEntity,
  CreateUnifiedTemplateRequest,
  UnifiedVerticalTemplate,
  InstanceSystemSelection,
  InstanceEntitySelection,
  CreateUnifiedInstanceRequest,
  UnifiedApiInstance,
  UnifiedInstanceGenerateRequest,
  // Request logs
  ListUnifiedRequestsQuery,
  UnifiedApiRequestLog,
  // Rate limits
  UpsertRateLimitRequest,
  RateLimitConfig,
  // Integrations & docs
  IntegrationAuthType,
  Integration,
  ListIntegrationsQuery,
  AvailableFilterOption,
  AvailableFilter,
  ReadOperation,
  ListReadOperationsQuery,
  WriteOperation,
  ListWriteOperationsQuery,
  SchemaLookupQuery,
  EntityDocumentation,
  IntegrationDocumentation
} from './types.js';
