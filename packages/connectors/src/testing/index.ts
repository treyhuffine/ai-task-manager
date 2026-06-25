/** Deterministic fakes for the test contract (§17). */
import type { Clock } from '../core/types';

export { inMemoryStore } from '../store/in-memory';
export type { MemoryStore } from '../store/in-memory';
export { plaintextSecretBox, aesGcmSecretBox, generateSecretKey } from '../crypto/aes-gcm';

export interface FakeClock extends Clock {
  advance(ms: number): void;
  set(t: number): void;
}

export function fakeClock(start = 1_700_000_000_000): FakeClock {
  let t = start;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
    set: (v) => {
      t = v;
    },
  };
}

export interface FakeHttpResponse {
  status?: number;
  json?: unknown;
  text?: string;
  headers?: Record<string, string>;
}

export interface FakeHttpCall {
  url: string;
  method: string;
  body?: string;
  headers: Record<string, string>;
}

export type FakeHttpHandler = (call: FakeHttpCall) => FakeHttpResponse | Promise<FakeHttpResponse>;

export interface FakeHttp {
  fetch: typeof fetch;
  calls: FakeHttpCall[];
}

/** A `fetch`-compatible stub driven by a handler; records every call for assertions. */
export function fakeHttp(handler: FakeHttpHandler): FakeHttp {
  const calls: FakeHttpCall[] = [];
  const fetchImpl = (async (input: Parameters<typeof fetch>[0], init: RequestInit = {}): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const headers: Record<string, string> = {};
    new Headers(init.headers ?? {}).forEach((v, k) => {
      headers[k] = v;
    });
    const bodyStr =
      typeof init.body === 'string'
        ? init.body
        : init.body instanceof URLSearchParams
          ? init.body.toString()
          : undefined;
    const call: FakeHttpCall = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      ...(bodyStr !== undefined ? { body: bodyStr } : {}),
      headers,
    };
    calls.push(call);
    const r = await handler(call);
    const resHeaders = new Headers(r.headers ?? {});
    let body: string | null = null;
    if (r.json !== undefined) {
      body = JSON.stringify(r.json);
      if (!resHeaders.has('content-type')) resHeaders.set('content-type', 'application/json');
    } else if (r.text !== undefined) {
      body = r.text;
    }
    return new Response(body, { status: r.status ?? 200, headers: resHeaders });
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}
