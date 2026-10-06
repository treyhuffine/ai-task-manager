import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { makeHarness } from '../packages/integrations/src/__tests__/_harness';
import { desktopOAuth } from '../src/lib/integrations/desktop-oauth';

const mocked = vi.hoisted(() => ({ runtime: vi.fn() }));
vi.mock('@/lib/integrations/runtime', () => ({ getIntegrationRuntime: mocked.runtime }));
import { POST } from '../src/app/api/integrations/connect/route';
import { GET } from '../src/app/api/integrations/callback/route';

afterEach(() => { desktopOAuth().close(); vi.unstubAllEnvs(); });

it('connects through the real engine using the temporary redirect and matching PKCE verifier', async () => {
  vi.stubEnv('RI_DESKTOP', '1');
  vi.stubEnv('RI_DESKTOP_CLIENT_SECRET', 'native-fixture-capability');
  const harness = makeHarness(); mocked.runtime.mockResolvedValue(harness.runtime);
  const response = await POST(new NextRequest('https://localhost/api/integrations/connect', {
    method: 'POST', headers: { 'x-ri-desktop-client': 'native-fixture-capability' }, body: JSON.stringify({ providerId: 'google', scopes: ['openid', 'email'], returnTo: '/welcome' }),
  }));
  expect(response.status).toBe(200);
  const result = await response.json();
  expect(result.desktopFlowId).toBeTruthy();
  expect(response.headers.get('set-cookie')).toBeNull();
  const authorization = new URL(result.authorizationUrl);
  const redirect = authorization.searchParams.get('redirect_uri')!;
  expect(redirect).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
  const completed = await fetch(`${redirect}?code=c&state=${result.requestId}`);
  expect(completed.status).toBe(200);
  expect(harness.env.exchangeCount).toBe(1);
  const exchange = harness.http.calls.find((c) => c.url.startsWith('https://oauth2.googleapis.com/token'))!;
  const form = new URLSearchParams(exchange.body);
  expect(form.get('redirect_uri')).toBe(redirect);
  expect(createHash('sha256').update(form.get('code_verifier')!).digest('base64url')).toBe(authorization.searchParams.get('code_challenge'));
  expect(await harness.runtime.listConnections()).toHaveLength(1);
  expect(await desktopOAuth().complete(new URLSearchParams(`state=${result.requestId}&code=c`))).toBe(false);
});

it('returns web sign-in to its initiating origin and path even when Next sees localhost', async () => {
  vi.stubEnv('RI_DESKTOP', '');
  const harness = makeHarness(); mocked.runtime.mockResolvedValue(harness.runtime);
  const response = await POST(new NextRequest('http://localhost:4224/api/integrations/connect', {
    method: 'POST', headers: { origin: 'https://app.example', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ providerId: 'google', returnTo: '/welcome?step=connect' }),
  }));
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.desktopFlowId).toBeUndefined();
  expect(response.headers.get('set-cookie')).toBeNull();
  const completed = await GET(new NextRequest(`http://localhost:4224/api/integrations/callback?code=c&state=${result.requestId}`));
  const back = new URL(completed.headers.get('location')!);
  expect(back.origin).toBe('https://app.example');
  expect(back.pathname).toBe('/welcome');
  expect(back.searchParams.get('step')).toBe('connect');
  expect(back.searchParams.has('connected')).toBe(true);
  expect(harness.env.exchangeCount).toBe(1);
});

it('uses the web callback for a phone on a desktop-capable backend', async () => {
  vi.stubEnv('RI_DESKTOP', '1');
  vi.stubEnv('RI_DESKTOP_CLIENT_SECRET', 'native-fixture-capability');
  const harness = makeHarness(); mocked.runtime.mockResolvedValue(harness.runtime);
  const response = await POST(new NextRequest('http://localhost:4224/api/integrations/connect', {
    method: 'POST', headers: { 'x-ri-desktop-client': 'untrusted-claim', origin: 'https://home.example', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ providerId: 'google', returnTo: '/welcome' }),
  }));
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.desktopFlowId).toBeUndefined();
  expect(new URL(result.authorizationUrl).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:0/callback');
  const completed = await GET(new NextRequest(`http://localhost:4224/api/integrations/callback?code=c&state=${result.requestId}`));
  const back = new URL(completed.headers.get('location')!);
  expect(back.origin).toBe('https://home.example');
  expect(back.pathname).toBe('/welcome');
  expect(back.searchParams.has('connected')).toBe(true);
  expect(harness.env.exchangeCount).toBe(1);
});

it('uses a relative callback fallback without a trusted initiating origin', async () => {
  const harness = makeHarness(); mocked.runtime.mockResolvedValue(harness.runtime);
  const response = await POST(new NextRequest('http://localhost:4224/api/integrations/connect', {
    method: 'POST', headers: { origin: 'https://untrusted.example', 'sec-fetch-site': 'cross-site' },
    body: JSON.stringify({ providerId: 'google', returnTo: '/a/..//untrusted.example' }),
  }));
  const result = await response.json();
  const completed = await GET(new NextRequest(`http://localhost:4224/api/integrations/callback?code=c&state=${result.requestId}`));
  expect(completed.headers.get('location')).toMatch(/^\/\?settings=plugins&connected=/);
  expect(harness.env.exchangeCount).toBe(1);
});

it('validates and consumes web denial state while returning only a coarse error to the remote page', async () => {
  vi.stubEnv('RI_DESKTOP_CLIENT_SECRET', 'native-fixture-capability');
  const harness = makeHarness(); mocked.runtime.mockResolvedValue(harness.runtime);
  const response = await POST(new NextRequest('http://localhost:4224/api/integrations/connect', {
    method: 'POST', headers: { origin: 'https://home.example', 'sec-fetch-site': 'same-origin' },
    body: JSON.stringify({ providerId: 'google', returnTo: '/welcome' }),
  }));
  const result = await response.json();
  const callback = new NextRequest(`http://localhost:4224/api/integrations/callback?error=private-provider-detail&state=${result.requestId}`);
  const denied = await GET(callback);
  expect(denied.headers.get('location')).toBe('https://home.example/welcome?error=authorization_cancelled');
  expect((await GET(callback)).headers.get('location')).toBe('/?settings=plugins&error=invalid_state');
  expect(harness.env.exchangeCount).toBe(0);
});

it.each(['code=c', 'error=access_denied'])('rejects a native state on the public callback (%s)', async (query) => {
  vi.stubEnv('RI_DESKTOP_CLIENT_SECRET', 'native-fixture-capability');
  const harness = makeHarness(); mocked.runtime.mockResolvedValue(harness.runtime);
  const response = await POST(new NextRequest('https://localhost/api/integrations/connect', {
    method: 'POST', headers: { 'x-ri-desktop-client': 'native-fixture-capability' },
    body: JSON.stringify({ providerId: 'google' }),
  }));
  const result = await response.json();
  expect(result.desktopFlowId).toBeTruthy();
  const rejected = await GET(new NextRequest(`http://localhost:4224/api/integrations/callback?${query}&state=${result.requestId}`));
  const back = new URL(rejected.headers.get('location')!, 'https://home.example');
  expect(back.searchParams.has('error')).toBe(true);
  expect(back.searchParams.has('connected')).toBe(false);
  expect(harness.env.exchangeCount).toBe(0);
  expect(await harness.runtime.listConnections()).toHaveLength(0);
});
