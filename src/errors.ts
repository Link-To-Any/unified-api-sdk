/**
 * Error hierarchy for the LinkToAny SDK.
 *
 * Every non-2xx API response is converted into a typed subclass of
 * {@link LinkToAnyError} so callers can branch on `instanceof` instead of
 * inspecting raw status codes.
 *
 * @module
 */

/** Shape of the error payload returned by the LinkToAny API. */
export interface LinkToAnyErrorBody {
  success?: boolean;
  message?: string;
  code?: string;
  error?: unknown;
  [key: string]: unknown;
}

/**
 * Base class for every error thrown by the SDK.
 *
 * @category Errors
 */
export class LinkToAnyError extends Error {
  /** HTTP status code of the failed response, if the request reached the server. */
  readonly status?: number;
  /** Machine-readable error code returned by the API (e.g. `AUTH_FAILED`). */
  readonly code?: string;
  /** Raw response body as parsed JSON, useful for debugging. */
  readonly body?: LinkToAnyErrorBody;
  /** Unique id of the HTTP request attempt, for correlating with logs. */
  readonly requestId?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      body?: LinkToAnyErrorBody;
      requestId?: string;
      cause?: unknown;
    } = {}
  ) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.status = options.status;
    this.code = options.code;
    this.body = options.body;
    this.requestId = options.requestId;
  }
}

/**
 * Thrown when the API key is missing or invalid (HTTP 401).
 *
 * @category Errors
 */
export class AuthenticationError extends LinkToAnyError {}

/**
 * Thrown when the API key lacks permission for the operation (HTTP 403).
 *
 * @category Errors
 */
export class PermissionError extends LinkToAnyError {}

/**
 * Thrown when the requested resource does not exist (HTTP 404).
 *
 * @category Errors
 */
export class NotFoundError extends LinkToAnyError {}

/**
 * Thrown when the request payload fails server-side validation
 * (HTTP 400 / 422).
 *
 * @category Errors
 */
export class ValidationError extends LinkToAnyError {}

/**
 * Thrown when the organisation or account exceeds its unified API rate
 * limit (HTTP 429). The SDK retries these automatically; this error is
 * only thrown once all retries are exhausted.
 *
 * @category Errors
 */
export class RateLimitError extends LinkToAnyError {
  /** Seconds to wait before retrying, from the `Retry-After` header. */
  readonly retryAfterSeconds?: number;

  constructor(
    message: string,
    options: ConstructorParameters<typeof LinkToAnyError>[1] & { retryAfterSeconds?: number } = {}
  ) {
    super(message, options);
    this.retryAfterSeconds = options.retryAfterSeconds;
  }
}

/**
 * Thrown for unexpected server-side failures (HTTP 5xx).
 *
 * @category Errors
 */
export class ServerError extends LinkToAnyError {}

/**
 * Thrown when the request never completed — network failure, DNS error
 * or client-side timeout. `cause` carries the underlying error.
 *
 * @category Errors
 */
export class ConnectionError extends LinkToAnyError {}

/**
 * Thrown when a request exceeded {@link LinkToAnyOptions.timeoutMs}.
 *
 * @category Errors
 */
export class TimeoutError extends ConnectionError {}

/**
 * Map an HTTP status + parsed body to the proper typed error.
 *
 * @internal
 */
export function errorFromResponse(
  status: number,
  body: LinkToAnyErrorBody | undefined,
  requestId: string,
  retryAfterSeconds?: number
): LinkToAnyError {
  const message =
    (typeof body?.message === 'string' && body.message) ||
    (typeof body?.error === 'string' && body.error) ||
    `Request failed with status ${status}`;
  const base = { status, code: body?.code, body, requestId };

  if (status === 401) return new AuthenticationError(message, base);
  if (status === 403) return new PermissionError(message, base);
  if (status === 404) return new NotFoundError(message, base);
  if (status === 400 || status === 422) return new ValidationError(message, base);
  if (status === 429) return new RateLimitError(message, { ...base, retryAfterSeconds });
  if (status >= 500) return new ServerError(message, base);
  return new LinkToAnyError(message, base);
}
