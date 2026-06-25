import { describe, it, expect } from 'vitest';
import { createAuthedHttp } from '../core/http';
import { oauth2 } from '../auth/oauth2';
import { createRedactor } from '../core/redactor';
import { ConnectorError, NeedsReauthError } from '../core/errors';
import { fakeHttp } from '../testing';
import type { Credentials } from '../core/types';

const strategy = oauth2({ authorizationUrl: 'https://a', tokenUrl: 'https://t' });

function setup(
  handlerFor: (call: { url: string; method: string; headers: Record<string, string> }) => { status?: number; json?: unknown; headers?: Record<string, string> },
) {
  const http = fakeHttp(async (c) => handlerFor(c));
  const redactor = createRedactor();
  let forceCalls = 0;
  const getCredentials = async (force?: boolean): Promise<Credentials> => {
    if (force) forceCalls++;
    return { type: 'oauth2', accessToken: force ? 'ACCESS-2' : 'ACCESS-1' };
  };
  const sleeps: number[] = [];
  const client = createAuthedHttp({
    baseUrl: 'https://api.example.com',
    strategy,
    connectionId: 'conn-1',
    getCredentials,
    redactor,
    fetch: http.fetch,
    sleep: async (ms) => { sleeps.push(ms); }, // no real delay in tests; record the backoff
  });
  return { client, http, redactor, getForceCalls: () => forceCalls, sleeps };
}

describe('AuthedHttp (§13)', () => {
  it('injects the bearer header and encodes query', async () => {
    const { client, http } = setup(() => ({ json: { ok: true } }));
    await client.get('/v1/things', { query: { a: 1, b: 'two', skip: undefined } });
    expect(http.calls[0]?.headers.authorization).toBe('Bearer ACCESS-1');
    expect(http.calls[0]?.url).toContain('a=1');
    expect(http.calls[0]?.url).toContain('b=two');
    expect(http.calls[0]?.url).not.toContain('skip');
  });

  it('refreshes and retries once on 401, then succeeds', async () => {
    let n = 0;
    const { client, getForceCalls } = setup((c) => {
      n++;
      return c.headers.authorization === 'Bearer ACCESS-2' ? { json: { done: true } } : { status: 401 };
    });
    const res = await client.get<{ done: boolean }>('/v1/x');
    expect(res.done).toBe(true);
    expect(getForceCalls()).toBe(1);
    expect(n).toBe(2);
  });

  it('throws NeedsReauth on a persistent 401 after refresh', async () => {
    const { client } = setup(() => ({ status: 401 }));
    await expect(client.get('/v1/x')).rejects.toBeInstanceOf(NeedsReauthError);
  });

  it('does not refresh on a non-refreshable 403', async () => {
    const { client, getForceCalls } = setup(() => ({ status: 403 }));
    await expect(client.get('/v1/x')).rejects.toMatchObject({ code: 'provider_error', status: 403 });
    expect(getForceCalls()).toBe(0);
  });

  it('maps 429 to provider_rate_limited with retryAfter', async () => {
    const { client } = setup(() => ({ status: 429, headers: { 'retry-after': '7' } }));
    await expect(client.get('/v1/x')).rejects.toMatchObject({ code: 'provider_rate_limited', retryAfter: 7 });
  });

  it('flags a 5xx on a mutating request as indeterminate', async () => {
    const { client } = setup(() => ({ status: 503 }));
    await expect(client.request({ method: 'POST', path: '/v1/send', body: {}, mutating: true })).rejects.toMatchObject({
      code: 'provider_unavailable',
      indeterminate: true,
    });
  });

  it('flags a network failure on a mutating request as indeterminate', async () => {
    const redactor = createRedactor();
    const throwingFetch = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    const client = createAuthedHttp({
      baseUrl: 'https://api.example.com',
      strategy,
      connectionId: 'c',
      getCredentials: async () => ({ type: 'oauth2', accessToken: 'A' }),
      redactor,
      fetch: throwingFetch,
    });
    const err = (await client.request({ method: 'POST', path: '/v1/send', mutating: true }).catch((e: unknown) => e)) as ConnectorError;
    expect(err).toBeInstanceOf(ConnectorError);
    expect(err.code).toBe('provider_unavailable');
    expect(err.indeterminate).toBe(true);
  });

  it('registers the bearer token with the redactor', async () => {
    const { client, redactor } = setup(() => ({ json: {} }));
    await client.get('/v1/x');
    expect(redactor.redact({ leak: 'ACCESS-1 here' })).toEqual({ leak: '[redacted:token] here' });
  });

  // ── transient retry (idempotency-aware) ──
  it('retries a non-mutating 5xx with backoff, then succeeds', async () => {
    let n = 0;
    const { client, sleeps } = setup(() => {
      n++;
      return n < 3 ? { status: 503 } : { json: { ok: true } };
    });
    const res = await client.get<{ ok: boolean }>('/v1/x');
    expect(res.ok).toBe(true);
    expect(n).toBe(3); // two failures + one success
    expect(sleeps.length).toBe(2); // backed off before each retry
  });

  it('retries a 429 even for a MUTATING request (429 = rejected, not applied)', async () => {
    let n = 0;
    const { client, sleeps } = setup(() => {
      n++;
      return n < 2 ? { status: 429, headers: { 'retry-after': '3' } } : { json: { ok: true } };
    });
    const res = await client.request<{ ok: boolean }>({ method: 'POST', path: '/v1/send', body: {}, mutating: true });
    expect(res.ok).toBe(true);
    expect(n).toBe(2);
    expect(sleeps[0]).toBe(3000); // honored Retry-After (seconds → ms)
  });

  it('does NOT retry a mutating 5xx (indeterminate — could double-apply)', async () => {
    let n = 0;
    const { client } = setup(() => {
      n++;
      return { status: 503 };
    });
    await expect(client.request({ method: 'POST', path: '/v1/send', body: {}, mutating: true })).rejects.toMatchObject({
      code: 'provider_unavailable',
      indeterminate: true,
    });
    expect(n).toBe(1); // one shot, no replay
  });

  it('gives up after maxRetries on a persistent non-mutating 5xx', async () => {
    let n = 0;
    const { client } = setup(() => {
      n++;
      return { status: 500 };
    });
    await expect(client.get('/v1/x')).rejects.toMatchObject({ code: 'provider_unavailable' });
    expect(n).toBe(4); // 1 initial + DEFAULT_RETRY_POLICY.maxRetries (3)
  });

  it('does NOT retry a non-transient 4xx', async () => {
    let n = 0;
    const { client } = setup(() => {
      n++;
      return { status: 404 };
    });
    await expect(client.get('/v1/x')).rejects.toMatchObject({ code: 'provider_error', status: 404 });
    expect(n).toBe(1);
  });
});
