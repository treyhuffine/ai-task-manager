import { afterEach, describe, expect, it, vi } from 'vitest';
import { DesktopOAuthManager, callbackParams, safeReturnPath, desktopRelayFor } from '../src/lib/connectors/desktop-oauth';
import { parseDeepLink, resultLocation } from './oauth-client';
import { relayResponse } from './relay/server.mjs';

const managers: DesktopOAuthManager[] = [];
const fresh = (ttl?: number) => { const manager = new DesktopOAuthManager(ttl); managers.push(manager); return manager; };
afterEach(() => { managers.splice(0).forEach((m) => m.close()); vi.unstubAllEnvs(); });

describe('desktop OAuth', () => {
  it('accepts only the matching listener/state, exchanges once, and replays status without credentials', async () => {
    const manager = fresh();
    const a = await manager.begin('google', { returnTo: '/welcome?step=connect' });
    const b = await manager.begin('microsoft');
    const exchange = vi.fn(async () => {});
    a.arm('nonce-a', exchange);
    b.arm('nonce-b', exchange);
    expect(a.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/oauth\/callback$/);
    expect((await fetch(`${a.redirectUri}?state=nonce-b&code=secret-code`)).status).toBe(400);
    expect((await fetch(`${a.redirectUri}?state=wrong&code=secret-code`)).status).toBe(400);
    expect(exchange).not.toHaveBeenCalled();
    expect((await fetch(`${a.redirectUri}?state=nonce-a&code=secret-code`)).status).toBe(200);
    expect(await manager.complete(new URLSearchParams('state=nonce-a&code=secret-code'))).toBe(false);
    expect(exchange).toHaveBeenCalledTimes(1);
    const results: unknown[] = [];
    manager.subscribe(0, (r) => results.push(r));
    expect(results).toMatchObject([{ sequence: 1, status: 'connected', returnTo: '/welcome?step=connect' }]);
    expect(JSON.stringify(results)).not.toContain('secret-code');
    await expect(fetch(a.redirectUri)).rejects.toThrow();
  });

  it('cancels and expires listeners, replaces old flows, and sanitizes exchange errors', async () => {
    const manager = fresh(60);
    const old = await manager.begin('google'); old.arm('old', async () => {});
    const current = await manager.begin('google'); current.arm('new', async () => { throw new Error('token=private'); });
    expect(await manager.complete(new URLSearchParams('state=old&code=c'))).toBe(false);
    const results: { status: string; message: string }[] = [];
    manager.subscribe(0, (r) => results.push(r));
    await manager.complete(new URLSearchParams('state=new&code=c'));
    expect(results[0]).toMatchObject({ status: 'error', message: 'Connection failed. Please try again.' });
    const cancelled = await manager.begin('cancel'); cancelled.arm('cancel', async () => {});
    manager.cancel(cancelled.id);
    expect(results[1].status).toBe('cancelled');
    const expired = await manager.begin('expiry'); expired.arm('expiry', async () => {});
    await new Promise((r) => setTimeout(r, 90));
    expect(await manager.complete(new URLSearchParams('state=expiry&code=c'))).toBe(false);
    expect(results[2].message).toContain('expired');
    await expect(fetch(expired.redirectUri)).rejects.toThrow();
  });

  it('supports hosted return links without arbitrary destinations or token leakage', async () => {
    const manager = fresh();
    const flow = await manager.begin('slack', { relayUrl: 'https://callback.example/oauth/callback', returnTo: '//evil.example' });
    flow.arm('nonce', async () => {});
    const response = relayResponse('/oauth/callback?code=authcode&state=nonce');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toBe('no-store');
    const link = response.body.match(/href="([^"]+)"/)![1].replaceAll('&amp;', '&');
    expect(await manager.complete(parseDeepLink(link)!)).toBe(true);
    expect(parseDeepLink('ri://evil/callback?code=c&state=s')).toBeNull();
    expect(parseDeepLink('https://oauth/callback?code=c&state=s')).toBeNull();
    for (const query of ['state=s&code=c&returnTo=https://evil.test', 'state=s&access_token=secret', 'state=s&code=a&code=b']) {
      expect(relayResponse(`/oauth/callback?${query}`).status).toBe(400);
      expect(() => callbackParams(new URLSearchParams(query))).toThrow();
    }
    expect(safeReturnPath('/\\evil.example')).toBe('/?settings=connectors');
    expect(resultLocation('https://localhost:42242', { sequence: 1, id: 'x', status: 'connected', returnTo: '//evil', message: 'Connected' })).toBe('https://localhost:42242/?settings=connectors&connected=Connected');
    await expect(manager.begin('bad', { relayUrl: 'http://example.test/cb' })).rejects.toThrow('HTTPS');
  });

  it('requires hosted callbacks for providers without PKCE', () => {
    vi.stubEnv('RI_DESKTOP_OAUTH_RELAY_URL', '');
    expect(desktopRelayFor('google', true)).toBeUndefined();
    expect(() => desktopRelayFor('slack', false)).toThrow('hosted callback');
    vi.stubEnv('RI_DESKTOP_OAUTH_RELAY_URL', 'https://callback.example/oauth/callback');
    vi.stubEnv('RI_DESKTOP_OAUTH_RELAY_PROVIDERS', 'google');
    expect(desktopRelayFor('google', true)).toBe('https://callback.example/oauth/callback');
  });
});
