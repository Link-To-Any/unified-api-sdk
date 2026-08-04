/**
 * Entities resource — manage unified entity contracts (the schema and
 * integration mappings behind each entity type) and generate them with
 * AI.
 *
 * @module
 */

import type { HttpClient, QueryValue } from '../http.js';
import { normalizeListResponse } from '../normalize.js';
import type {
  ApiResponse,
  GenerateUnifiedContractsRequest,
  GenerationTask,
  ListUnifiedContractsQuery,
  ObjectId,
  RequestOptions,
  UnifiedContract,
  UpsertUnifiedContractRequest
} from '../types.js';

/**
 * Manage unified entity contracts and AI contract generation.
 *
 * Accessed via {@link LinkToAny.entities | `client.entities`}.
 *
 * @category Resources
 */
export class EntitiesResource {
  /** @internal */
  constructor(private readonly http: HttpClient) {}

  /**
   * List unified entity contracts — each contract defines an entity's
   * unified schema and how it maps onto integrations.
   */
  async list(
    query: ListUnifiedContractsQuery = {},
    options?: RequestOptions
  ): Promise<ApiResponse<UnifiedContract[]>> {
    const response = await this.http.request<ApiResponse<unknown>>({
      method: 'GET',
      path: '/unified',
      query: query as Record<string, QueryValue>,
      options
    });
    return normalizeListResponse<UnifiedContract>(response, 'contracts');
  }

  /**
   * Create or replace the contract for a unified entity type — its
   * unified Zod schema plus read/write mappings onto integration
   * operations.
   *
   * @param entityType - Unified entity type the contract describes.
   * @param body - Schema and mappings; at least one read or write mapping
   *   is required, and mapping keys must be unique.
   */
  upsert(
    entityType: string,
    body: UpsertUnifiedContractRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<UnifiedContract>> {
    return this.http.request({
      method: 'PUT',
      path: `/unified/${encodeURIComponent(entityType)}`,
      body,
      options
    });
  }

  /**
   * Kick off AI generation of unified entity contracts across
   * integrations.
   *
   * Two modes:
   * - **Manual grouping** — pass `entities` with explicit read/write
   *   mappings per entity type.
   * - **Auto-discovery** — pass `syncRequestConfigIds` /
   *   `pushRequestConfigIds` (read/write operation ids) and let the AI
   *   group them into unified entities.
   *
   * Generation is asynchronous: poll the returned task with
   * {@link getGenerationTask} or use {@link waitForGeneration}.
   */
  generate(
    body: GenerateUnifiedContractsRequest,
    options?: RequestOptions
  ): Promise<ApiResponse<GenerationTask>> {
    return this.http.request({ method: 'POST', path: '/unified/generate', body, options });
  }

  /** Fetch the state of an async contract-generation task. */
  getGenerationTask(
    taskId: ObjectId,
    options?: RequestOptions
  ): Promise<ApiResponse<GenerationTask>> {
    return this.http.request({
      method: 'GET',
      path: `/unified/generate/${encodeURIComponent(taskId)}`,
      options
    });
  }

  /**
   * Poll a generation task until it leaves the pending/processing states
   * or `timeoutMs` elapses.
   *
   * @param taskId - Task returned by {@link generate}.
   * @param pollOptions - `intervalMs` between polls (default 3000) and a
   *   total `timeoutMs` budget (default 300000 — 5 minutes).
   * @returns The terminal task document.
   * @throws Error when the timeout budget is exhausted first.
   */
  async waitForGeneration(
    taskId: ObjectId,
    pollOptions: { intervalMs?: number; timeoutMs?: number } = {},
    options?: RequestOptions
  ): Promise<GenerationTask> {
    const intervalMs = pollOptions.intervalMs ?? 3_000;
    const timeoutMs = pollOptions.timeoutMs ?? 300_000;
    const deadline = Date.now() + timeoutMs;
    const pendingStates = new Set(['pending', 'queued', 'processing', 'in_progress', 'running']);

    for (;;) {
      const { data: task } = await this.getGenerationTask(taskId, options);
      if (!pendingStates.has(String(task.status).toLowerCase())) {
        return task;
      }
      if (Date.now() + intervalMs > deadline) {
        throw new Error(`Generation task ${taskId} did not complete within ${timeoutMs}ms`);
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }
}
