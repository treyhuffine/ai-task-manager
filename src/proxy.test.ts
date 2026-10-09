import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';

/**
 * The proxy authenticates every API request, and a root that is not the
 * active home serves nothing but health and session (docs/homes-spec.md
 * §10.3).
 */

let home: TestHome;
let token: string;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-proxy-' });
  const { pairDevice } = await import('@/lib/db/queries');
  token = pairDevice({ name: 'Phone', kind: 'phone' }).token.plaintext;
  const { resetHomeIdentityCache } = await import('@/lib/home/identity');
  resetHomeIdentityCache();
});

afterEach(async () => {
  const { resetHomeIdentityCache } = await import('@/lib/home/identity');
  resetHomeIdentityCache();
  await home.cleanup();
  vi.unstubAllEnvs();
});

function request(pathname: string, bearer?: string) {
  return new NextRequest(`http://127.0.0.1${pathname}`, {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  });
}

const passesThrough = (res: Response) => res.headers.get('x-middleware-next') === '1';

/** The value a header will have for the route handler, after the proxy. */
const forwarded = (res: Response, name: string) => res.headers.get(`x-middleware-request-${name}`);

describe('proxy', () => {
  it('refuses a request without a valid key', async () => {
    const { proxy } = await import('./proxy');
    expect(proxy(request('/api/tasks')).status).toBe(401);
    expect(proxy(request('/api/tasks', 'ri_live_not_a_key')).status).toBe(401);
  });

  it('lets an authenticated request through to an active home', async () => {
    const { proxy } = await import('./proxy');
    expect(passesThrough(proxy(request('/api/tasks', token)))).toBe(true);
  });

  it('tells handlers which key called, replacing anything the caller claimed', async () => {
    const { proxy } = await import('./proxy');
    const { findApiKeyByHash } = await import('@/lib/db/queries');
    const { hashToken } = await import('@/lib/auth/tokens');
    const key = findApiKeyByHash(hashToken(token))!;
    const req = new NextRequest('http://127.0.0.1/api/tasks', {
      headers: { authorization: `Bearer ${token}`, 'x-ri-api-key-id': 'forged', 'x-ri-caller-location': 'home' },
    });
    const res = proxy(req);
    expect(forwarded(res, 'x-ri-api-key-id')).toBe(key.id);
    expect(forwarded(res, 'x-ri-caller-location')).toBe('elsewhere');
  });

  it('strips claimed key headers on public routes too', async () => {
    const { proxy } = await import('./proxy');
    const res = proxy(
      new NextRequest('http://127.0.0.1/api/health', { headers: { 'x-ri-caller-location': 'home' } }),
    );
    expect(passesThrough(res)).toBe(true);
    expect(forwarded(res, 'x-ri-caller-location')).toBeNull();
  });

  it('passes only the local broker protocol to its credential adapter by default', async () => {
    vi.stubEnv('RI_LOCAL_APPS', undefined);
    const { proxy } = await import('./proxy');
    for (const operation of ['capabilities', 'call']) {
      const res = proxy(new NextRequest(`http://127.0.0.1/api/local-apps/broker/v1/${operation}`, {
        headers: { 'x-ri-api-key-id': 'forged', 'x-ri-caller-location': 'home' },
      }));
      expect(passesThrough(res)).toBe(true);
      expect(forwarded(res, 'x-ri-api-key-id')).toBeNull();
      expect(forwarded(res, 'x-ri-caller-location')).toBeNull();
    }
    expect(proxy(request('/api/local-apps/import')).status).toBe(401);
    expect(proxy(request('/api/local-apps/broker/v1/unknown')).status).toBe(401);
  });

  it('does not bypass Home authentication for a disabled local broker', async () => {
    vi.stubEnv('RI_LOCAL_APPS', '0');
    const { proxy } = await import('./proxy');
    expect(proxy(request('/api/local-apps/broker/v1/call')).status).toBe(401);
  });

  it('answers 503 on a root that is not the active home, apart from health', async () => {
    const { proxy } = await import('./proxy');
    const { resolveHomeIdentity, resetHomeIdentityCache } = await import('@/lib/home/identity');
    resolveHomeIdentity();
    fs.rmSync(path.join(home.configDir, 'machine.json'));
    resetHomeIdentityCache();

    const res = proxy(request('/api/tasks', token));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: 'home_not_active' });
    expect(passesThrough(proxy(request('/api/health')))).toBe(true);
  });
});

describe('browser API compatibility before handlers', () => {
  it('rejects a newer client before any route handler can mutate data', async () => {
    const { proxy } = await import('./proxy');
    const res = proxy(new NextRequest('http://127.0.0.1/api/tasks', { method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'x-ri-api-protocol': '99' }, body: '{"title":"must not be written"}' }));
    expect(passesThrough(res)).toBe(false);
    expect(res.status).toBe(426);
    expect(await res.json()).toMatchObject({ code: 'api_protocol', update: 'home' });
  });
  it('keeps API-compatible patch clients working and authenticates unsupported ones first', async () => {
    const { proxy } = await import('./proxy');
    expect(passesThrough(proxy(new NextRequest('http://127.0.0.1/api/tasks', { method: 'POST', headers: { authorization: `Bearer ${token}`, 'x-ri-api-protocol': '1' } })))).toBe(true);
    expect(proxy(new NextRequest('http://127.0.0.1/api/tasks', { method: 'POST', headers: { 'x-ri-api-protocol': '99' } })).status).toBe(401);
  });
  it('does not make missing old metadata a bypass once baseline1 is retired', async () => {
    const { proxy } = await import('./proxy');
    const { CURRENT_COMPATIBILITY } = await import('@/lib/releases/compatibility');
    const before = CURRENT_COMPATIBILITY.apiProtocols;
    CURRENT_COMPATIBILITY.apiProtocols = [2];
    try {
      expect(proxy(request('/api/tasks', token)).status).toBe(426);
      expect(passesThrough(proxy(request('/api/version', token)))).toBe(true);
      expect(proxy(request('/api/version')).status).toBe(401);
      for (const endpoint of ['/api/mcp', '/api/integrations/mcp', '/api/webhooks/example', '/api/integrations/callback']) expect(passesThrough(proxy(request(endpoint, token)))).toBe(true);
    } finally { CURRENT_COMPATIBILITY.apiProtocols = before; }
  });
});
