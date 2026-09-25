import { afterEach, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { NextRequest } from 'next/server';
import { makeHarness } from '../packages/connectors/src/__tests__/_harness';
import { desktopOAuth } from '../src/lib/connectors/desktop-oauth';

const mocked = vi.hoisted(() => ({ runtime: vi.fn() }));
vi.mock('@/lib/connectors/runtime', () => ({ getConnectorRuntime: mocked.runtime }));
import { POST } from '../src/app/api/connectors/connect/route';

afterEach(() => { desktopOAuth().close(); vi.unstubAllEnvs(); });

it('connects through the real engine using the temporary redirect and matching PKCE verifier', async () => {
  vi.stubEnv('RI_DESKTOP', '1');
  const harness = makeHarness(); mocked.runtime.mockResolvedValue(harness.runtime);
  const response = await POST(new NextRequest('https://localhost/api/connectors/connect', {
    method: 'POST', body: JSON.stringify({ providerId: 'google', scopes: ['openid', 'email'], returnTo: '/welcome' }),
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

it('preserves the normal web callback and return cookie outside desktop', async () => {
  vi.stubEnv('RI_DESKTOP', '');
  const harness = makeHarness(); mocked.runtime.mockResolvedValue(harness.runtime);
  const response = await POST(new NextRequest('https://localhost/api/connectors/connect', {
    method: 'POST', body: JSON.stringify({ providerId: 'google', returnTo: '/welcome' }),
  }));
  const result = await response.json();
  expect(response.status).toBe(200);
  expect(result.desktopFlowId).toBeUndefined();
  expect(response.headers.get('set-cookie')).toContain('connector_return_to');
});
