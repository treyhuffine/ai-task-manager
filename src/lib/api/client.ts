/**
 * Typed HTTP client for the app's own `/api` surface.
 *
 * Single source of truth for three concerns that used to be sprinkled through
 * individual `fetch` calls:
 *
 *   1. Auth injection — an `Authorization: Bearer <token>` header is added
 *      from localStorage when present. Browser sessions also get an httpOnly
 *      cookie set on pair (see `/api/session`); the middleware accepts either.
 *      Both transports carry the same API key — the cookie exists so that
 *      browser-native loads (`<img>`, `<audio>`, `EventSource`) work without
 *      client code having to attach headers they can't attach anyway.
 *
 *   2. JSON envelope — request bodies become JSON when plain, `FormData`
 *      passes through untouched (so the browser picks the multipart boundary),
 *      non-2xx responses throw typed `ApiError`s the callers can pattern-match.
 *
 *   3. Unauthorized recovery — any 401 clears local auth state and bounces to
 *      `/pair`. Centralised so we can't forget this at a call site.
 *
 * Non-browser clients (CLI, iOS Shortcuts, service tokens) can't rely on
 * cookies so they keep using the Bearer header directly — nothing about this
 * client prevents that.
 */

import { APP_SHORT_ID } from '@/constants/app';

export const AUTH_TOKEN_STORAGE_KEY = `${APP_SHORT_ID}.token`;
const DEFAULT_BASE_URL = '/api';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: unknown,
    public readonly url: string,
  ) {
    super(`API ${status} ${url}`);
    this.name = 'ApiError';
  }
}

/**
 * One line a person can act on, out of whatever the failure actually was.
 *
 * Route handlers are inconsistent about which key carries the human-readable
 * part: some send `{ error }`, some send `{ error: <name>, message }` so the
 * client can branch on the name. Prefer `message` when both are present, since
 * `error` is the machine-facing one in that shape, and fall back to the status
 * so an empty body still says something.
 */
export function apiErrorText(err: unknown): string {
  if (err instanceof ApiError) {
    const body = err.body as { error?: string; message?: string } | null;
    return body?.message ?? body?.error ?? `Request failed (${err.status})`;
  }
  return err instanceof Error ? err.message : String(err);
}

/** Stable machine-facing error code from a route's `{ code }` field, when present. */
/** The structured `details` an error envelope carried, if any (e.g. the running
 * workstreams behind an `active_execution` conflict). */
export function apiErrorDetails<T = unknown>(err: unknown): T | undefined {
  if (err instanceof ApiError) {
    const body = err.body as { details?: T } | null;
    return body?.details;
  }
  return undefined;
}

export function apiErrorCode(err: unknown): string | undefined {
  if (err instanceof ApiError) {
    const body = err.body as { code?: string } | null;
    return body?.code;
  }
  return undefined;
}

/** Primitive values allowed as query params; arrays are comma-joined. */
type QueryValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | (string | number | boolean)[];

export interface RequestOptions {
  /** Extra headers merged over the defaults (auth, content-type). */
  headers?: HeadersInit;
  /** Abort signal — composed with `timeoutMs` if both are set. */
  signal?: AbortSignal;
  /** Query params. `undefined`/`null` are skipped; arrays become `a,b,c`. */
  query?: Record<string, QueryValue>;
  /** How to decode a successful response. Default `'json'`. */
  responseType?: 'json' | 'text' | 'blob' | 'response';
  /** Per-request timeout in ms. Fires an AbortError when exceeded. */
  timeoutMs?: number;
}

export interface ApiClientOptions {
  baseUrl?: string;
  getToken?: () => string | null;
  /** Called on any 401. Default clears localStorage + redirects to /pair. */
  onUnauthorized?: () => void;
}

// ─── Local-auth helpers ─────────────────────────────────────────

export function getAuthToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, token);
  } catch {
    // ignore
  }
}

export function clearAuthToken(): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function defaultOnUnauthorized(): void {
  clearAuthToken();
  if (typeof window === 'undefined') return;
  // Clear the httpOnly session cookie server-side. Fire-and-forget — if it
  // fails, the cookie will just fail middleware on next use anyway, it can't
  // grant access.
  fetch('/api/session', { method: 'DELETE' }).catch(() => {});
  if (window.location.pathname === '/pair') return;
  window.location.assign('/pair');
}

// ─── Client ─────────────────────────────────────────────────────

export class ApiClient {
  private readonly baseUrl: string;
  private readonly getToken: () => string | null;
  private readonly onUnauthorized: () => void;

  constructor(opts: ApiClientOptions = {}) {
    this.baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
    this.getToken = opts.getToken ?? getAuthToken;
    this.onUnauthorized = opts.onUnauthorized ?? defaultOnUnauthorized;
  }

  get<T>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('GET', path, undefined, opts);
  }

  post<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, body, opts);
  }

  patch<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>('PATCH', path, body, opts);
  }

  put<T>(path: string, body?: unknown, opts?: RequestOptions): Promise<T> {
    return this.request<T>('PUT', path, body, opts);
  }

  delete<T = void>(path: string, opts?: RequestOptions): Promise<T> {
    return this.request<T>('DELETE', path, undefined, opts);
  }

  /**
   * Multipart upload. Caller builds the `FormData`; we don't set
   * `Content-Type` so the browser can pick the boundary.
   */
  upload<T>(path: string, formData: FormData, opts?: RequestOptions): Promise<T> {
    return this.request<T>('POST', path, formData, opts);
  }

  /**
   * Escape hatch that returns the raw `Response`. Use for streaming (SSE),
   * blob downloads that need special handling, or anywhere the typed helpers
   * get in the way. Still applies auth and 401 handling.
   */
  async raw(path: string, init: RequestInit = {}): Promise<Response> {
    const headers = this.buildHeaders(init.headers);
    const url = this.buildUrl(path);
    const res = await fetch(url, { ...init, headers });
    if (res.status === 401) this.onUnauthorized();
    return res;
  }

  // ─── Internals ────────────────────────────────────────────────

  private async request<T>(
    method: string,
    path: string,
    body: unknown,
    opts: RequestOptions = {},
  ): Promise<T> {
    const url = this.buildUrl(path, opts.query);
    const { signal, clear } = this.composeSignal(opts.signal, opts.timeoutMs);

    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
    const hasJsonBody = body !== undefined && body !== null && !isFormData;

    const headers = this.buildHeaders(opts.headers, hasJsonBody ? 'application/json' : undefined);

    const init: RequestInit = { method, headers, signal };
    if (isFormData) {
      init.body = body as FormData;
    } else if (hasJsonBody) {
      init.body = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await fetch(url, init);
    } finally {
      clear();
    }

    return this.handleResponse<T>(res, url, opts.responseType);
  }

  private buildUrl(path: string, query?: RequestOptions['query']): string {
    const origin =
      typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
    const full = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const url = new URL(full, origin);

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          url.searchParams.set(key, value.join(','));
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    return url.toString();
  }

  private buildHeaders(init?: HeadersInit, contentType?: string): Headers {
    const headers = new Headers(init);
    const token = this.getToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    if (contentType && !headers.has('Content-Type')) {
      headers.set('Content-Type', contentType);
    }
    return headers;
  }

  private composeSignal(
    external: AbortSignal | undefined,
    timeoutMs: number | undefined,
  ): { signal: AbortSignal | undefined; clear: () => void } {
    if (!timeoutMs) return { signal: external, clear: () => {} };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('timeout')), timeoutMs);
    if (external) {
      if (external.aborted) controller.abort(external.reason);
      else external.addEventListener('abort', () => controller.abort(external.reason), { once: true });
    }
    return {
      signal: controller.signal,
      clear: () => clearTimeout(timer),
    };
  }

  private async handleResponse<T>(
    res: Response,
    url: string,
    responseType: RequestOptions['responseType'] = 'json',
  ): Promise<T> {
    if (res.status === 401) {
      this.onUnauthorized();
      throw new ApiError(401, await safeJson(res), url);
    }

    if (responseType === 'response') return res as unknown as T;

    if (!res.ok) {
      throw new ApiError(res.status, await safeJson(res), url);
    }

    if (res.status === 204) return undefined as T;

    switch (responseType) {
      case 'text':
        return (await res.text()) as unknown as T;
      case 'blob':
        return (await res.blob()) as unknown as T;
      case 'json':
      default: {
        // Some endpoints return empty bodies on success; tolerate that.
        const text = await res.text();
        if (!text) return undefined as T;
        try {
          return JSON.parse(text) as T;
        } catch {
          // Non-JSON 2xx — fall back to raw text so callers see *something*.
          return text as unknown as T;
        }
      }
    }
  }
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

export const api = new ApiClient();
