/**
 * Centralized HTTP client for the collector API.
 *
 * Use these primitives instead of bare `fetch(\`${COLLECTOR_URL}/...\`)` calls.
 * Auth, base URL, and error handling are handled here.
 *
 * Higher-level typed wrappers live in `services/api/index.ts`.
 */

import { COLLECTOR_URL } from '../config';

const ADMIN_TOKEN = import.meta.env.VITE_ADMIN_TOKEN || '';

export class CollectorApiError extends Error {
  constructor(public status: number, public path: string, message: string) {
    super(`Collector ${status} on ${path}: ${message}`);
    this.name = 'CollectorApiError';
  }
}

interface RequestOptions {
  signal?: AbortSignal;
  /** Add Authorization Bearer header. Required for all write endpoints. */
  auth?: boolean;
  /** Timeout in ms (default 10000). Use 0 to disable. */
  timeoutMs?: number;
}

function buildHeaders(auth: boolean, hasBody: boolean): HeadersInit {
  const headers: Record<string, string> = {};
  if (hasBody) headers['Content-Type'] = 'application/json';
  if (auth) headers['Authorization'] = `Bearer ${ADMIN_TOKEN}`;
  return headers;
}

function buildSignal(opts: RequestOptions): AbortSignal | undefined {
  if (opts.signal) return opts.signal;
  const timeout = opts.timeoutMs ?? 10000;
  return timeout > 0 ? AbortSignal.timeout(timeout) : undefined;
}

/** Build a full URL with optional query params. */
export function buildUrl(path: string, params?: Record<string, string | number | undefined | null>): string {
  const url = new URL(path.startsWith('/') ? path : `/${path}`, COLLECTOR_URL);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** GET — returns parsed JSON, or throws CollectorApiError. */
export async function apiGet<T>(path: string, params?: Record<string, string | number | undefined | null>, opts: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path, params);
  const res = await fetch(url, { headers: buildHeaders(opts.auth ?? false, false), signal: buildSignal(opts) });
  if (!res.ok) throw new CollectorApiError(res.status, path, await res.text().catch(() => ''));
  return await res.json() as T;
}

/** GET — returns parsed JSON, or `null` on any error. Useful for non-critical reads. */
export async function apiGetSafe<T>(path: string, params?: Record<string, string | number | undefined | null>, opts: RequestOptions = {}): Promise<T | null> {
  try {
    return await apiGet<T>(path, params, opts);
  } catch {
    return null;
  }
}

/** POST — sends JSON body, returns parsed response. */
export async function apiPost<T = void>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path);
  const res = await fetch(url, {
    method: 'POST',
    headers: buildHeaders(opts.auth ?? true, body !== undefined),
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: buildSignal(opts),
  });
  if (!res.ok) throw new CollectorApiError(res.status, path, await res.text().catch(() => ''));
  // 204 No Content / empty body case
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** PATCH — sends JSON body, returns parsed response. */
export async function apiPatch<T = void>(path: string, body: unknown, opts: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path);
  const res = await fetch(url, {
    method: 'PATCH',
    headers: buildHeaders(opts.auth ?? true, true),
    body: JSON.stringify(body),
    signal: buildSignal(opts),
  });
  if (!res.ok) throw new CollectorApiError(res.status, path, await res.text().catch(() => ''));
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** DELETE — returns parsed response. */
export async function apiDelete<T = void>(path: string, opts: RequestOptions = {}): Promise<T> {
  const url = buildUrl(path);
  const res = await fetch(url, {
    method: 'DELETE',
    headers: buildHeaders(opts.auth ?? true, false),
    signal: buildSignal(opts),
  });
  if (!res.ok) throw new CollectorApiError(res.status, path, await res.text().catch(() => ''));
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Re-export so callers don't need to import COLLECTOR_URL separately. */
export { COLLECTOR_URL };
