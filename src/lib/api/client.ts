import { APP_SHORT_ID } from '@/constants/app';

const BASE_URL = '/api';

export const AUTH_TOKEN_STORAGE_KEY = `${APP_SHORT_ID}.token`;

export class ApiError extends Error {
  constructor(
    public status: number,
    public body: unknown,
  ) {
    super(`API error ${status}`);
    this.name = 'ApiError';
  }
}

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

function redirectToPair(): void {
  if (typeof window === 'undefined') return;
  if (window.location.pathname === '/pair') return;
  window.location.assign('/pair');
}

function authHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const token = getAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return headers;
}

/**
 * Drop-in replacement for `fetch()` that injects the auth token and handles 401s.
 * Use this for direct `fetch('/api/…')` calls that bypass the `api` wrapper
 * (e.g. streaming responses, FormData uploads).
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = authHeaders(init.headers);
  const res = await fetch(input, { ...init, headers });
  if (res.status === 401) {
    clearAuthToken();
    redirectToPair();
  }
  return res;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (res.status === 401) {
    clearAuthToken();
    redirectToPair();
    const body = await safeJson(res);
    throw new ApiError(res.status, body);
  }

  if (res.status === 204) return undefined as T;

  const body = await res.json();

  if (!res.ok) {
    throw new ApiError(res.status, body);
  }

  return body as T;
}

async function safeJson(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

function buildUrl(path: string, params?: Record<string, unknown>): string {
  const url = new URL(`${BASE_URL}${path}`, window.location.origin);

  if (params) {
    for (const [key, value] of Object.entries(params)) {
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

export const api = {
  get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    return fetch(buildUrl(path, params), { headers: authHeaders() }).then(handleResponse<T>);
  },

  post<T>(path: string, body: unknown): Promise<T> {
    return fetch(buildUrl(path), {
      method: 'POST',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    }).then(handleResponse<T>);
  },

  patch<T>(path: string, body: unknown): Promise<T> {
    return fetch(buildUrl(path), {
      method: 'PATCH',
      headers: authHeaders({ 'Content-Type': 'application/json' }),
      body: JSON.stringify(body),
    }).then(handleResponse<T>);
  },

  delete(path: string): Promise<void> {
    return fetch(buildUrl(path), {
      method: 'DELETE',
      headers: authHeaders(),
    }).then(handleResponse<void>);
  },
};
