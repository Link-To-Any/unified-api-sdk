/**
 * Internal HTTP transport: base-URL resolution, auth headers, timeouts,
 * retries with exponential backoff, and typed error mapping.
 *
 * @internal
 * @module
 */

import {
  ConnectionError,
  TimeoutError,
  errorFromResponse,
  type UniflowErrorBody
} from './errors.js';
import type { RequestOptions, UniflowClientOptions, UniflowEnvironment } from './types.js';

/** Base URL per environment. */
const BASE_URLS: Record<UniflowEnvironment, string> = {
  dev: 'https://api.staging.linktoany.com',
  prod: 'https://api.linktoany.com'
};

/** Statuses retried automatically. */
const RETRYABLE_STATUSES = new Set([429, 502, 503, 504]);

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_RETRIES = 2;

/** Resolve the effective base URL from client options. @internal */
export function resolveBaseUrl(options: Pick<UniflowClientOptions, 'baseUrl' | 'environment'>): string {
  if (options.baseUrl) {
    return options.baseUrl.replace(/\/+$/, '');
  }
  return BASE_URLS[options.environment ?? 'prod'];
}

/** Query value types accepted by {@link HttpClient.request}. @internal */
export type QueryValue = string | number | boolean | string[] | Record<string, string> | undefined;

interface InternalRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, QueryValue>;
  body?: unknown;
  options?: RequestOptions;
}

/**
 * Thin fetch wrapper shared by all resources.
 *
 * @internal
 */
export class HttpClient {
  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;
  private requestCounter = 0;

  constructor(options: UniflowClientOptions) {
    if (!options.apiKey || !options.apiKey.trim()) {
      throw new Error('UniflowClient: `apiKey` is required');
    }
    if (options.environment && !(options.environment in BASE_URLS)) {
      throw new Error(
        `UniflowClient: invalid environment '${options.environment}' — expected 'dev' or 'prod'`
      );
    }

    this.baseUrl = resolveBaseUrl(options);
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
    this.fetchImpl = options.fetch ?? fetch;

    this.headers = {
      'content-type': 'application/json',
      accept: 'application/json',
      authorization: `Bearer ${options.apiKey}`,
      'user-agent': 'unified-api-sdk-node/0.2.0',
      ...(options.organisationId ? { 'x-posx-organisation-id': options.organisationId } : {}),
      ...(options.userId ? { 'x-posx-user-id': options.userId } : {}),
      ...(options.applicationId ? { 'x-posx-application-id': options.applicationId } : {}),
      ...options.defaultHeaders
    };
  }

  /** The resolved base URL this client talks to. */
  get resolvedBaseUrl(): string {
    return this.baseUrl;
  }

  /** Perform a JSON request and return the parsed body. */
  async request<T>(req: InternalRequest): Promise<T> {
    const url = this.buildUrl(req.path, req.query);
    const maxRetries = req.options?.maxRetries ?? this.maxRetries;
    const timeoutMs = req.options?.timeoutMs ?? this.timeoutMs;
    const requestId = `uf_${Date.now().toString(36)}_${(++this.requestCounter).toString(36)}`;

    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (attempt > 0) {
        await sleep(backoffMs(attempt, lastError));
      }

      let response: Response;
      try {
        response = await this.send(url, req, timeoutMs, requestId);
      } catch (error) {
        lastError = error as Error;
        // Timeouts and network failures are retryable; user aborts are not.
        if (req.options?.signal?.aborted || attempt === maxRetries) {
          throw error;
        }
        continue;
      }

      if (response.ok) {
        return (await parseJson(response)) as T;
      }

      const body = (await parseJson(response)) as UniflowErrorBody | undefined;
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));
      const error = errorFromResponse(response.status, body, requestId, retryAfter);

      if (!RETRYABLE_STATUSES.has(response.status) || attempt === maxRetries) {
        throw error;
      }
      lastError = error;
    }

    /* istanbul ignore next -- loop always returns or throws */
    throw lastError ?? new ConnectionError('Request failed', { requestId });
  }

  private async send(
    url: string,
    req: InternalRequest,
    timeoutMs: number,
    requestId: string
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const externalSignal = req.options?.signal;
    const onExternalAbort = () => controller.abort(externalSignal?.reason);
    externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

    try {
      return await this.fetchImpl(url, {
        method: req.method,
        headers: { ...this.headers, ...req.options?.headers },
        body: req.body === undefined ? undefined : JSON.stringify(req.body),
        signal: controller.signal
      });
    } catch (error) {
      if (externalSignal?.aborted) {
        throw new ConnectionError('Request aborted by caller', { requestId, cause: error });
      }
      if ((error as Error).name === 'AbortError' || controller.signal.aborted) {
        throw new TimeoutError(`Request timed out after ${timeoutMs}ms`, { requestId, cause: error });
      }
      throw new ConnectionError(
        `Network error: ${(error as Error).message}`,
        { requestId, cause: error }
      );
    } finally {
      clearTimeout(timer);
      externalSignal?.removeEventListener('abort', onExternalAbort);
    }
  }

  private buildUrl(path: string, query?: Record<string, QueryValue>): string {
    const url = new URL(this.baseUrl + path);
    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          if (value.length > 0) url.searchParams.set(key, value.join(','));
        } else if (typeof value === 'object') {
          // Nested filters serialize as filters[name]=value
          for (const [subKey, subValue] of Object.entries(value)) {
            url.searchParams.set(`${key}[${subKey}]`, subValue);
          }
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return url.toString();
  }
}

async function parseJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function parseRetryAfter(header: string | null): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

function backoffMs(attempt: number, lastError: Error | undefined): number {
  const retryAfter = (lastError as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  if (retryAfter !== undefined) {
    return Math.min(retryAfter * 1000, 60_000);
  }
  const base = 500 * 2 ** (attempt - 1);
  return base + Math.floor(Math.random() * base * 0.25);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
