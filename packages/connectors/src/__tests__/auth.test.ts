import { describe, it, expect } from 'vitest';
import { makeHarness } from './_harness';
import type { Credentials } from '../core/types';

async function storedCreds(h: ReturnType<typeof makeHarness>, connId: string): Promise<Credentials | null> {
  const s = await h.store.get(connId);
  return s ? (JSON.parse(s.sealed) as { plaintext: Credentials }).plaintext : null;
}

describe('OAuth connect / completeAuth (§9)', () => {
  it('exchanges the code, identifies the account, and stores a connection', async () => {
    const h = makeHarness();
    const conn = await h.connect({ email: 'me@gmail.com' });
    expect(conn.accountId).toBe('sub:me@gmail.com');
    expect(conn.email).toBe('me@gmail.com');
    expect(conn.status).toBe('active');
    expect(h.env.exchangeCount).toBe(1);
    const creds = await storedCreds(h, conn.id);
    expect(creds).toMatchObject({ type: 'oauth2', accessToken: 'access-EXCH', refreshToken: 'refresh-RT' });
  });

  it('sends PKCE: challenge in the auth URL, verifier in the exchange', async () => {
    const h = makeHarness();
    const begin = await h.runtime.beginAuth('google', { scopes: ['openid', 'email'] });
    expect(begin.authorizationUrl).toContain('code_challenge=');
    expect(begin.authorizationUrl).toContain('code_challenge_method=S256');
    await h.runtime.completeAuth({ code: 'c', state: begin.requestId });
    const exchange = h.http.calls.find((c) => c.url.startsWith('https://oauth2.googleapis.com/token') && (c.body ?? '').includes('authorization_code'));
    expect(exchange?.body).toContain('code_verifier=');
  });

  it('rejects a reused state (single-use)', async () => {
    const h = makeHarness();
    const begin = await h.runtime.beginAuth('google', { scopes: ['openid', 'email'] });
    await h.runtime.completeAuth({ code: 'c', state: begin.requestId });
    await expect(h.runtime.completeAuth({ code: 'c', state: begin.requestId })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('refresh algorithm (§9)', () => {
  it('PRESERVES the refresh token when the response omits it', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    h.clock.advance(3600_000); // past expiry
    h.env.refresh = () => ({ json: { access_token: 'access-REFRESHED', expires_in: 3600 } }); // no refresh_token
    h.env.action = () => ({ status: 200, json: { items: [] } });
    await h.runtime.runAction('google_calendar.list_calendars', {});
    const creds = await storedCreds(h, conn.id);
    expect(creds).toMatchObject({ accessToken: 'access-REFRESHED', refreshToken: 'refresh-RT' });
    expect(h.env.refreshCount).toBe(1);
  });

  it('ROTATES the refresh token when the response includes a new one', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    h.clock.advance(3600_000);
    h.env.refresh = () => ({ json: { access_token: 'access-REFRESHED', refresh_token: 'refresh-RT2', expires_in: 3600 } });
    h.env.action = () => ({ status: 200, json: { items: [] } });
    await h.runtime.runAction('google_calendar.list_calendars', {});
    const creds = await storedCreds(h, conn.id);
    expect(creds).toMatchObject({ accessToken: 'access-REFRESHED', refreshToken: 'refresh-RT2' });
  });

  it('refreshes PROACTIVELY within the skew window (before hard expiry)', async () => {
    const h = makeHarness();
    await h.connect(); // expires_in 3600s
    h.clock.advance(3600_000 - 30_000); // 30s before expiry; skew is 60s → stale
    h.env.action = () => ({ status: 200, json: { items: [] } });
    await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(h.env.refreshCount).toBe(1);
  });

  it('SINGLE-FLIGHTS: two concurrent expired calls trigger exactly one refresh', async () => {
    const h = makeHarness();
    await h.connect();
    h.clock.advance(3600_000); // expired
    h.env.action = () => ({ status: 200, json: { items: [] } });
    await Promise.all([
      h.runtime.runAction('google_calendar.list_calendars', {}),
      h.runtime.runAction('google_calendar.list_events', { calendarId: 'primary' }),
    ]);
    expect(h.env.refreshCount).toBe(1);
  });

  it('flips to needs_reauth and returns auth_required when refresh is revoked', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    h.clock.advance(3600_000);
    h.env.refresh = () => ({ status: 400, json: { error: 'invalid_grant' } });
    const outcome = await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(outcome).toMatchObject({ ok: false, reason: 'auth_required', providerId: 'google' });
    const reloaded = await h.store.get(conn.id);
    expect(reloaded?.connection.status).toBe('needs_reauth');
  });

  it('does NOT tear down a healthy connection on a TRANSIENT refresh failure (429) (P1-d)', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    h.clock.advance(3600_000); // expired → refresh attempted
    h.env.refresh = () => ({ status: 429, json: { error: 'rate_limited' } });
    const outcome = await h.runtime.runAction('google_calendar.list_calendars', {});
    // Transient, retryable — NOT auth_required, and the connection stays active so a later
    // (un-rate-limited) call can refresh and succeed.
    expect(outcome).toMatchObject({ ok: false, reason: 'error', code: 'provider_unavailable' });
    const reloaded = await h.store.get(conn.id);
    expect(reloaded?.connection.status).toBe('active');
  });

  it('treats a non-revocation 4xx (invalid_request) as transient, not definitive (P1-d)', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    h.clock.advance(3600_000);
    h.env.refresh = () => ({ status: 400, json: { error: 'invalid_request' } });
    const outcome = await h.runtime.runAction('google_calendar.list_calendars', {});
    expect(outcome).toMatchObject({ ok: false, reason: 'error', code: 'provider_unavailable' });
    expect((await h.store.get(conn.id))?.connection.status).toBe('active');
  });
});
