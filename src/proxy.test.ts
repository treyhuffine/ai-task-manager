import fs from 'node:fs';
import path from 'node:path';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
  const { createApiKey } = await import('@/lib/db/queries');
  token = createApiKey({ name: 'Phone', deviceType: 'phone' }).token.plaintext;
  const { resetHomeIdentityCache } = await import('@/lib/home/identity');
  resetHomeIdentityCache();
});

afterEach(async () => {
  const { resetHomeIdentityCache } = await import('@/lib/home/identity');
  resetHomeIdentityCache();
  await home.cleanup();
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
      headers: { authorization: `Bearer ${token}`, 'x-ri-api-key-id': 'forged', 'x-ri-api-key-type': 'host' },
    });
    const res = proxy(req);
    expect(forwarded(res, 'x-ri-api-key-id')).toBe(key.id);
    expect(forwarded(res, 'x-ri-api-key-type')).toBe('phone');
  });

  it('strips claimed key headers on public routes too', async () => {
    const { proxy } = await import('./proxy');
    const res = proxy(
      new NextRequest('http://127.0.0.1/api/health', { headers: { 'x-ri-api-key-type': 'host' } }),
    );
    expect(passesThrough(res)).toBe(true);
    expect(forwarded(res, 'x-ri-api-key-type')).toBeNull();
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
