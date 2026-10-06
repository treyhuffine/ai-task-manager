/**
 * Direct + custom auth strategies through the real `createAuthedHttp` path, so the
 * header/query/body placement (and http.ts's body-overlay merge) is exercised end to end.
 */
import { describe, it, expect } from 'vitest';
import { createAuthedHttp } from '../core/http';
import { createRedactor } from '../core/redactor';
import { apiKey, bearer, basic, custom } from '../auth/direct';
import { fakeHttp } from '../testing';
import type { AuthStrategy, Credentials } from '../core/types';

function client(strategy: AuthStrategy, creds: Credentials) {
  const fh = fakeHttp(async () => ({ json: { ok: true } }));
  const http = createAuthedHttp({
    baseUrl: 'https://api.example.com',
    strategy,
    connectionId: 'c1',
    getCredentials: async () => creds,
    redactor: createRedactor(),
    fetch: fh.fetch,
  });
  return { http, fh };
}

describe('apiKey placement', () => {
  it('header, default Authorization, no prefix', async () => {
    const { http, fh } = client(apiKey(), { type: 'api_key', apiKey: 'K' });
    await http.get('/x');
    expect(fh.calls[0]?.headers.authorization).toBe('K');
  });

  it('header with a prefix (bearer-style)', async () => {
    const { http, fh } = client(apiKey({ prefix: 'Bearer ' }), { type: 'api_key', apiKey: 'K' });
    await http.get('/x');
    expect(fh.calls[0]?.headers.authorization).toBe('Bearer K');
  });

  it('custom header name', async () => {
    const { http, fh } = client(apiKey({ name: 'X-API-Key' }), { type: 'api_key', apiKey: 'K' });
    await http.get('/x');
    expect(fh.calls[0]?.headers['x-api-key']).toBe('K');
  });

  it('query placement', async () => {
    const { http, fh } = client(apiKey({ in: 'query', name: 'api_key' }), { type: 'api_key', apiKey: 'K' });
    await http.get('/x', { query: { existing: '1' } });
    const url = new URL(fh.calls[0]?.url as string);
    expect(url.searchParams.get('api_key')).toBe('K');
    expect(url.searchParams.get('existing')).toBe('1'); // caller query preserved
  });
});

describe('bearer + basic', () => {
  it('bearer sets Authorization: Bearer', async () => {
    const { http, fh } = client(bearer(), { type: 'bearer', token: 'T' });
    await http.get('/x');
    expect(fh.calls[0]?.headers.authorization).toBe('Bearer T');
  });

  it('basic sets Authorization: Basic <b64>', async () => {
    const { http, fh } = client(basic(), { type: 'basic', username: 'u', password: 'p' });
    await http.get('/x');
    expect(fh.calls[0]?.headers.authorization).toBe(`Basic ${Buffer.from('u:p').toString('base64')}`);
  });
});

describe('custom escape hatch', () => {
  it('injects multiple headers', async () => {
    const strat = custom({
      secretFields: ['key', 'org'],
      apply: (req, v) => {
        req.headers['X-Key'] = v.key as string;
        req.headers['X-Org'] = v.org as string;
      },
    });
    const { http, fh } = client(strat, { type: 'custom', values: { key: 'K', org: 'O' } });
    await http.get('/x');
    expect(fh.calls[0]?.headers['x-key']).toBe('K');
    expect(fh.calls[0]?.headers['x-org']).toBe('O');
  });

  it('injects credentials into the JSON body (Plaid-style)', async () => {
    const strat = custom({
      secretFields: ['client_id', 'secret'],
      apply: (req, v) => {
        req.setBodyField('client_id', v.client_id);
        req.setBodyField('secret', v.secret);
      },
    });
    const { http, fh } = client(strat, { type: 'custom', values: { client_id: 'CID', secret: 'SEC' } });
    await http.post('/accounts', { access_token: 'at' });
    const body = JSON.parse(fh.calls[0]?.body as string);
    expect(body).toEqual({ access_token: 'at', client_id: 'CID', secret: 'SEC' });
  });

  it('confines its secret values (sentinel never escapes the redactor)', async () => {
    // The runtime registers custom values via registerSecrets; here assert tokenOf refuses a token.
    const strat = custom({ secretFields: ['k'], apply: (req, v) => (req.headers['X-K'] = v.k as string) });
    expect(() => strat.tokenOf({ type: 'custom', values: { k: 'x' } })).toThrow();
  });
});
