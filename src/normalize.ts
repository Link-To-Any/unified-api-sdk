/**
 * Response-shape normalization.
 *
 * The Unified API gateway wraps some list responses in an envelope
 * (`data.items`, `data.systems`, ...) while others return `data` as a
 * plain array. Resources normalize through {@link listData} so callers
 * always receive a typed array.
 *
 * @internal
 * @module
 */

import type { ApiResponse } from './types.js';

/**
 * Extract the array from a list response `data` payload, whether it is
 * the array itself or an envelope containing it under `items` or a
 * resource-specific key.
 *
 * @internal
 */
export function listData<T>(data: unknown, ...extraKeys: string[]): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }
  if (data && typeof data === 'object') {
    for (const key of [...extraKeys, 'items']) {
      const value = (data as Record<string, unknown>)[key];
      if (Array.isArray(value)) {
        return value as T[];
      }
    }
  }
  return [];
}

/**
 * Normalize a full list response so `data` is always the typed array.
 *
 * @internal
 */
export function normalizeListResponse<T>(
  response: ApiResponse<unknown>,
  ...extraKeys: string[]
): ApiResponse<T[]> {
  return { ...response, data: listData<T>(response.data, ...extraKeys) };
}
