/**
 * Docs resource — pull as much documentation as the Unified API holds
 * about an integration in one call: the integration itself, its
 * readable and writable entities, available filters and unified entity
 * contracts.
 *
 * @module
 */

import type {
  AvailableFilter,
  EntityDocumentation,
  IntegrationDocumentation,
  ObjectId,
  ReadOperation,
  RequestOptions,
  UnifiedContract,
  WriteOperation
} from '../types.js';
import type { EntitiesResource } from './entities.js';
import type { IntegrationsResource } from './integrations.js';

type WarningSource = IntegrationDocumentation['warnings'][number]['source'];

/**
 * Aggregated, DB-backed documentation for integrations.
 *
 * Accessed via {@link LinkToAny.docs | `client.docs`}.
 *
 * @category Resources
 */
export class DocsResource {
  /** @internal */
  constructor(
    private readonly integrations: IntegrationsResource,
    private readonly entities: EntitiesResource
  ) {}

  /**
   * Assemble everything the Unified API knows about an integration: the
   * integration itself, its read operations, write operations and the
   * unified entity contracts that map it — merged into a per-entity
   * capability view with available filters.
   *
   * Sources are fetched in parallel. A failing source does not fail the
   * whole call: it is reported in `warnings` and its section is empty, so
   * you always get the documentation that IS available.
   *
   * @param systemId - Integration to document.
   *
   * @example
   * ```ts
   * const docs = await client.docs.describeIntegration(systemId);
   *
   * console.log(docs.integration?.name, docs.integration?.supportedAuthTypes);
   * for (const entity of docs.entities) {
   *   console.log(
   *     entity.entityType,
   *     entity.readable ? 'read' : '',
   *     entity.writable ? 'write' : '',
   *     'filters:', entity.filters.map(f => f.paramName)
   *   );
   * }
   * ```
   */
  async describeIntegration(
    systemId: ObjectId,
    options?: RequestOptions
  ): Promise<IntegrationDocumentation> {
    const warnings: IntegrationDocumentation['warnings'] = [];

    const [integration, readOperations, writeOperations, contracts] = await Promise.all([
      this.guard('integration', warnings, async () => (await this.integrations.get(systemId, options)).data, null),
      this.guard('readOperations', warnings, async () => (await this.integrations.listReadOperations({ systemId }, options)).data, []),
      this.guard('writeOperations', warnings, async () => (await this.integrations.listWriteOperations({ systemId }, options)).data, []),
      this.guard('contracts', warnings, async () => (await this.entities.list({ systemIds: [systemId] }, options)).data, [])
    ]);

    return {
      integration,
      entities: buildEntityDocs(systemId, readOperations, writeOperations, contracts),
      readOperations,
      writeOperations,
      contracts,
      warnings
    };
  }

  /**
   * List the entity types an integration can read and/or write through
   * the Unified API, with their capabilities and filters. Shorthand for
   * {@link describeIntegration | `describeIntegration(systemId).entities`}.
   */
  async listEntities(systemId: ObjectId, options?: RequestOptions): Promise<EntityDocumentation[]> {
    const docs = await this.describeIntegration(systemId, options);
    return docs.entities;
  }

  /**
   * Get the filters available when reading an entity from an integration
   * — what you can pass as `filters` to
   * {@link RecordsResource.list | `records.list`} (subject to the entity
   * contract's filter mapping).
   *
   * @param systemId - Integration the entity belongs to.
   * @param entityType - Integration entity type (matched case-insensitively).
   */
  async getEntityFilters(
    systemId: ObjectId,
    entityType: string,
    options?: RequestOptions
  ): Promise<AvailableFilter[]> {
    const { data } = await this.integrations.listReadOperations({ systemId, entityType }, options);
    return dedupeFilters(data.flatMap(operation => operation.availableFilters ?? []));
  }

  /**
   * Document every integration in the catalogue at once. Fetches the
   * integration list, then {@link describeIntegration} for each — use
   * sparingly on large catalogues.
   */
  async describeAllIntegrations(options?: RequestOptions): Promise<IntegrationDocumentation[]> {
    const { data: integrations } = await this.integrations.list({}, options);
    return Promise.all(
      integrations.map(integration => this.describeIntegration(integration._id, options))
    );
  }

  private async guard<T>(
    source: WarningSource,
    warnings: IntegrationDocumentation['warnings'],
    task: () => Promise<T>,
    fallback: T
  ): Promise<T> {
    try {
      const result = await task();
      return result ?? fallback;
    } catch (error) {
      warnings.push({
        source,
        message: error instanceof Error ? error.message : String(error)
      });
      return fallback;
    }
  }
}

/** Merge operations and contracts into a per-entity capability view. */
function buildEntityDocs(
  systemId: ObjectId,
  readOperations: ReadOperation[],
  writeOperations: WriteOperation[],
  contracts: UnifiedContract[]
): EntityDocumentation[] {
  const entities = new Map<string, EntityDocumentation>();

  const entry = (entityType: string): EntityDocumentation => {
    const key = entityType.toLowerCase();
    let doc = entities.get(key);
    if (!doc) {
      doc = {
        entityType: key,
        readable: false,
        writable: false,
        filters: [],
        readOperations: [],
        writeOperations: [],
        contracts: []
      };
      entities.set(key, doc);
    }
    return doc;
  };

  for (const operation of readOperations) {
    if (!operation.entityType) continue;
    const doc = entry(operation.entityType);
    doc.readable = true;
    doc.readOperations.push(operation);
    doc.filters = dedupeFilters([...doc.filters, ...(operation.availableFilters ?? [])]);
  }

  for (const operation of writeOperations) {
    if (!operation.entityType) continue;
    const doc = entry(operation.entityType);
    doc.writable = true;
    doc.writeOperations.push(operation);
  }

  for (const contract of contracts) {
    const mappings = [
      ...(contract.readMappings ?? []).map(m => ({ systemId: m.systemId, entityType: m.sourceEntityType })),
      ...(contract.writeMappings ?? []).map(m => ({ systemId: m.systemId, entityType: m.targetEntityType }))
    ];
    for (const mapping of mappings) {
      if (mapping.systemId !== systemId || !mapping.entityType) continue;
      const doc = entry(mapping.entityType);
      if (!doc.contracts.some(c => c === contract)) {
        doc.contracts.push(contract);
      }
    }
  }

  return [...entities.values()].sort((a, b) => a.entityType.localeCompare(b.entityType));
}

/** Dedupe filters by paramName, first occurrence wins. */
function dedupeFilters(filters: AvailableFilter[]): AvailableFilter[] {
  const seen = new Map<string, AvailableFilter>();
  for (const filter of filters) {
    if (!seen.has(filter.paramName)) {
      seen.set(filter.paramName, filter);
    }
  }
  return [...seen.values()];
}
