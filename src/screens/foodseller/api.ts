/**
 * Food Seller - API client. Same shape and retry safety as the Bachat Gat client:
 * stock and money writes carry an Idempotency-Key, so a retry after a dropped
 * connection can never post twice.
 */

import { ApiFetch, ShgApiError } from '../bachatgat/api';

export class FoodApiError extends ShgApiError {
  code?: string;
  shortages?: { productId: number; name: string; unit: string; shortBy: number }[];
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(params?: Query) {
  if (!params) return '';
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function createFoodApi(apiFetch: ApiFetch) {
  async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string, query?: Query): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let res: Response;
    try {
      res = await apiFetch(`/api/foodseller${path}${qs(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // A write may have reached the server before the connection dropped.
      throw new FoodApiError('network', 0, undefined, method !== 'GET');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = new FoodApiError((data && (data.error as string)) || `Server error (${res.status})`, res.status, data?.details, res.status >= 500 && method !== 'GET');
      err.code = data?.code;
      err.shortages = data?.shortages;
      throw err;
    }
    return data as T;
  }

  return {
    get: <T = any>(path: string, query?: Query) => request<T>('GET', path, undefined, undefined, query),
    post: <T = any>(path: string, body?: unknown, idempotencyKey?: string) => request<T>('POST', path, body ?? {}, idempotencyKey),
    put: <T = any>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
    del: <T = any>(path: string) => request<T>('DELETE', path),
  };
}

export type FoodApi = ReturnType<typeof createFoodApi>;
