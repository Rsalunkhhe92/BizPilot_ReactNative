/**
 * Mahila Bachat Gat - API client.
 *
 * Wraps the app's apiFetch (which adds the login token and finds a reachable
 * backend). Financial writes carry an Idempotency-Key: the same key is reused
 * when the user retries after a network drop, so the server posts at most once
 * and a retry simply returns the original receipt.
 */

export type ApiFetch = (path: string, options?: RequestInit) => Promise<Response>;

export class ShgApiError extends Error {
  status: number;
  details?: string[];
  /** true when the request may or may not have reached the server */
  uncertain: boolean;
  constructor(message: string, status: number, details?: string[], uncertain = false) {
    super(message);
    this.status = status;
    this.details = details;
    this.uncertain = uncertain;
  }
}

export function newIdempotencyKey(): string {
  const rand = () => Math.random().toString(36).slice(2, 10);
  return `${Date.now().toString(36)}-${rand()}${rand()}`;
}

type Query = Record<string, string | number | boolean | null | undefined>;

function qs(params?: Query) {
  if (!params) return '';
  const parts = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
  return parts.length ? `?${parts.join('&')}` : '';
}

export function createShgApi(apiFetch: ApiFetch) {
  async function request<T>(method: string, path: string, body?: unknown, idempotencyKey?: string, query?: Query): Promise<T> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
    let res: Response;
    try {
      res = await apiFetch(`/api/bachatgat${path}${qs(query)}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      // Writes may have reached the server before the connection dropped.
      throw new ShgApiError('network', 0, undefined, method !== 'GET');
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const message = (data && (data.error as string)) || `Server error (${res.status})`;
      throw new ShgApiError(message, res.status, data?.details, res.status >= 500 && method !== 'GET');
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

export type ShgApi = ReturnType<typeof createShgApi>;
