/**
 * The authenticated HTTP client (§3/§9/§13) — a trust boundary. It resolves
 * relative paths against the provider base URL, injects auth (and silently
 * refresh-retries once on a refreshable status), maps provider errors to the
 * taxonomy, registers the bearer token with the `Redactor`, and flags
 * post-send mutating failures as `indeterminate`.
 */
import type { AuthStrategy, AuthedHttp, Credentials, HttpRequest, Redactor, RetryPolicy } from './types';
import { ConnectorError, NeedsReauthError } from './errors';

/** Default transient-retry policy: 3 tries after the first, exponential 0.5s→30s backoff. */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxRetries: 3,
  initialDelayMs: 500,
  maxDelayMs: 30_000,
  backoffMultiplier: 2,
};

export interface CreateAuthedHttpOptions {
  baseUrl?: string;
  strategy: AuthStrategy;
  connectionId: string;
  /** Returns valid credentials; `force` refreshes past the proactive window (§9). */
  getCredentials(force?: boolean): Promise<Credentials>;
  redactor: Redactor;
  fetch?: typeof fetch;
  /** Transient-failure retry policy (idempotency-aware). Defaults to {@link DEFAULT_RETRY_POLICY}. */
  retry?: RetryPolicy;
  /** Injectable delay (tests pass a no-op to skip real backoff). Defaults to an abortable `setTimeout`. */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

function joinUrl(baseUrl: string | undefined, path: string): string {
  if (/^https?:\/\//i.test(path)) return path;
  if (!baseUrl) throw new ConnectorError('internal_error', `relative path "${path}" with no provider baseUrl`);
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

function resolveUrl(baseUrl: string | undefined, path: string, query: HttpRequest['query']): string {
  const url = new URL(joinUrl(baseUrl, path));
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** Merge auth-added query params (query-placement strategies) into a resolved URL. */
function appendQuery(url: string, extra: Record<string, string>): string {
  const keys = Object.keys(extra);
  if (keys.length === 0) return url;
  const u = new URL(url);
  for (const k of keys) u.searchParams.set(k, extra[k] as string);
  return u.toString();
}

async function parseBody<T>(res: Response): Promise<T> {
  if (res.status === 204 || res.status === 205) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const text = await res.text();
  if (!text) return undefined as T;
  if (ct.includes('application/json') || ct.includes('+json')) return JSON.parse(text) as T;
  return text as unknown as T;
}

function retryAfterSeconds(res: Response): number | undefined {
  const h = res.headers.get('retry-after');
  if (!h) return undefined;
  // RFC 7231: either delta-seconds or an HTTP-date.
  const n = Number(h);
  if (Number.isFinite(n)) return Math.max(0, n);
  const when = Date.parse(h);
  if (!Number.isNaN(when)) return Math.max(0, Math.ceil((when - Date.now()) / 1000));
  return undefined;
}

export function createAuthedHttp(opts: CreateAuthedHttpOptions): AuthedHttp {
  const fetchImpl = opts.fetch ?? fetch;
  const { strategy, redactor, connectionId } = opts;
  const retry = opts.retry ?? DEFAULT_RETRY_POLICY;
  const sleep =
    opts.sleep ??
    ((ms: number, signal?: AbortSignal) =>
      new Promise<void>((resolve, reject) => {
        const abort = () => reject(signal?.reason ?? new ConnectorError('provider_unavailable', 'request aborted'));
        if (signal?.aborted) return abort();
        const t = setTimeout(resolve, ms);
        signal?.addEventListener('abort', () => { clearTimeout(t); abort(); }, { once: true });
      }));

  /**
   * Is this failure safe to replay? 429 means the request was REJECTED (never processed), so it's
   * safe even for a mutating call. 5xx / network failures are only retried when NOT
   * post-send-indeterminate — i.e. a non-mutating call (a mutating one sets `indeterminate`, where a
   * replay could double-apply). Everything else (4xx, needs-reauth) is not transient.
   */
  function isTransient(e: unknown): boolean {
    if (!(e instanceof ConnectorError)) return false;
    if (e.code === 'provider_rate_limited') return true;
    if (e.code === 'provider_unavailable') return !e.indeterminate;
    return false;
  }

  function retryDelayMs(attempt: number, e: ConnectorError): number {
    // Honor a server Retry-After (seconds) when present, capped; else exponential backoff + jitter.
    if (typeof e.retryAfter === 'number') return Math.min(e.retryAfter * 1000, retry.maxDelayMs);
    const base = Math.min(retry.initialDelayMs * retry.backoffMultiplier ** attempt, retry.maxDelayMs);
    const jitter = base * 0.1 * (Math.random() * 2 - 1);
    return Math.max(0, Math.floor(base + jitter));
  }

  async function send<T>(req: HttpRequest): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await sendOnce<T>(req);
      } catch (e) {
        if (attempt < retry.maxRetries && isTransient(e)) {
          // If the provider asked us to wait longer than our cap, don't burn attempts on it —
          // surface the rate-limit so the caller can decide, rather than clamp-and-retry blindly.
          const ra = (e as ConnectorError).retryAfter;
          if (typeof ra === 'number' && ra * 1000 > retry.maxDelayMs) throw e;
          await sleep(retryDelayMs(attempt, e as ConnectorError), req.signal);
          continue;
        }
        throw e;
      }
    }
  }

  async function sendOnce<T>(req: HttpRequest): Promise<T> {
    let creds = await opts.getCredentials();
    let refreshed = false;

    for (;;) {
      const headers: Record<string, string> = { Accept: 'application/json', ...(req.headers ?? {}) };

      // Build the body before auth so signing strategies can sign over it.
      let bodyInit: string | undefined;
      if (req.rawBody !== undefined) {
        bodyInit = req.rawBody;
        if (req.contentType) headers['Content-Type'] = req.contentType;
      } else if (req.body !== undefined) {
        bodyInit = JSON.stringify(req.body);
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      }

      // Resolve the URL (base + path + caller query) BEFORE auth, so signers sign over the
      // real URL. The strategy may add headers and/or query params (header-injectors, signers,
      // and query-placement strategies all flow through this one hook).
      const baseUrl = resolveUrl(opts.baseUrl, req.path, req.query);
      const extraQuery: Record<string, string> = {};
      const bodyOverlay: Record<string, unknown> = {};
      let rewrittenUrl: string | undefined;
      strategy.applyAuth(creds, {
        method: req.method,
        url: baseUrl,
        headers,
        ...(bodyInit !== undefined ? { body: bodyInit } : {}),
        addQueryParam: (k, v) => {
          extraQuery[k] = v;
        },
        setBodyField: (k, v) => {
          bodyOverlay[k] = v;
        },
        setUrl: (u) => {
          rewrittenUrl = u;
        },
      });
      // Body-injected auth (e.g. Plaid client_id/secret) — merge into the JSON body, re-serialize.
      // No-op for signers (they read `body` and add no overlay), so a signature stays valid.
      if (Object.keys(bodyOverlay).length > 0 && req.rawBody === undefined) {
        const base = typeof req.body === 'object' && req.body !== null ? (req.body as Record<string, unknown>) : {};
        bodyInit = JSON.stringify({ ...base, ...bodyOverlay });
        headers['Content-Type'] = headers['Content-Type'] ?? 'application/json';
      }
      const url = appendQuery(rewrittenUrl ?? baseUrl, extraQuery);

      try {
        redactor.register(strategy.tokenOf(creds), 'token');
      } catch {
        /* tokenOf throws for signing/malformed creds; registerSecrets already confined them */
      }
      if (headers.Authorization) redactor.register(headers.Authorization, 'authorization');

      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: req.method,
          headers,
          ...(bodyInit !== undefined ? { body: bodyInit } : {}),
          ...(req.signal ? { signal: req.signal } : {}),
        });
      } catch (cause) {
        // Network failure / abort. A mutating request may have landed → indeterminate.
        throw new ConnectorError('provider_unavailable', 'provider request failed', {
          indeterminate: !!req.mutating,
          cause,
        });
      }

      const refreshable = res.status === 401 || (strategy.oauth?.refreshableStatuses.includes(res.status) ?? false);
      if (refreshable && !refreshed && strategy.oauth) {
        refreshed = true;
        creds = await opts.getCredentials(true); // force refresh; throws NeedsReauth on revocation
        continue;
      }

      if (res.ok) return await parseBody<T>(res);

      // ── error mapping (§13) ──
      if (res.status === 401) {
        // Still 401 after a refresh attempt → the grant is no good.
        throw new NeedsReauthError(connectionId, 'provider rejected credentials after refresh');
      }
      const message = `provider error ${res.status} for ${req.method} ${req.path}`;
      if (res.status === 429) {
        throw new ConnectorError('provider_rate_limited', message, {
          status: 429,
          retryAfter: retryAfterSeconds(res),
        });
      }
      if (res.status >= 500) {
        throw new ConnectorError('provider_unavailable', message, {
          status: res.status,
          indeterminate: !!req.mutating,
        });
      }
      throw new ConnectorError('provider_error', message, { status: res.status });
    }
  }

  const http: AuthedHttp = {
    request: send,
    get: (path, o) => send({ method: 'GET', path, ...o }),
    post: (path, body, o) => send({ method: 'POST', path, body, ...o }),
    put: (path, body, o) => send({ method: 'PUT', path, body, ...o }),
    patch: (path, body, o) => send({ method: 'PATCH', path, body, ...o }),
    delete: (path, o) => send({ method: 'DELETE', path, ...o }),
  };
  return http;
}
