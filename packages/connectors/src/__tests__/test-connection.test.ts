/**
 * testConnection() — the cheap connection health probe (Ri `testRequest`). Forces a refresh, then
 * runs identify(); distinguishes active / needs_reauth / error WITHOUT a real action, and heals a
 * stale stored status. Driven through the Google harness (refresh + userinfo are controllable).
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { defineProvider, defineToolkit } from '../core/authoring';
import { oauth2 } from '../auth/oauth2';
import { bearer } from '../auth/direct';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { AuthedHttp, IdentifyContext } from '../core/types';
import { makeHarness } from './_harness';

const RU = 'http://127.0.0.1/cb';
const emptyToolkit = (id: string) => defineToolkit({ id, providerId: id, displayName: id, actions: [] });

describe('runtime.testConnection (health probe)', () => {
  it('returns ok/active/verified for a healthy connection (refresh + identify both succeed)', async () => {
    const h = makeHarness();
    const conn = await h.connect({ email: 'me@gmail.com' });
    const before = h.env.refreshCount;

    const res = await h.runtime.testConnection(conn.id);
    expect(res).toMatchObject({ connectionId: conn.id, ok: true, status: 'active', verified: true });
    expect(typeof res.checkedAt).toBe('string');
    expect(h.env.refreshCount).toBe(before + 1); // forced a refresh to exercise the token
  });

  it('returns needs_reauth and marks the connection when the refresh is revoked', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    h.env.refresh = () => ({ status: 400, json: { error: 'invalid_grant' } }); // definitive revocation

    const res = await h.runtime.testConnection(conn.id);
    expect(res).toMatchObject({ ok: false, status: 'needs_reauth' });
    const [stored] = await h.runtime.listConnections();
    expect(stored?.status).toBe('needs_reauth'); // healed the stored status
  });

  it('returns error (NOT needs_reauth) for a transient refresh failure', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    h.env.refresh = () => ({ status: 500 }); // transient — must never tear down the connection

    const res = await h.runtime.testConnection(conn.id);
    expect(res.ok).toBe(false);
    expect(res.status).toBe('error');
    const [stored] = await h.runtime.listConnections();
    expect(stored?.status).toBe('active'); // a flaky probe leaves the connection intact
  });

  it('heals a stale needs_reauth status when the connection is actually healthy', async () => {
    const h = makeHarness();
    const conn = await h.connect();
    await h.store.setStatus(conn.id, 'needs_reauth', 'stale');

    const res = await h.runtime.testConnection(conn.id);
    expect(res.ok).toBe(true);
    const [stored] = await h.runtime.listConnections();
    expect(stored?.status).toBe('active');
  });

  it('throws connection_not_found for an unknown id', async () => {
    const h = makeHarness();
    await expect(h.runtime.testConnection('nope')).rejects.toMatchObject({ code: 'connection_not_found' });
  });
});

// ── probe-selection matrix (healthCheck vs identify-fallback vs refresh-only) ──
function rig(opts: {
  providerId: string;
  oauth?: boolean;
  identify?: (http: AuthedHttp, ctx: IdentifyContext) => Promise<{ accountId: string }>;
  healthCheck?: (http: AuthedHttp, ctx: { config: Record<string, unknown> }) => Promise<void>;
  handler: (url: string) => { status?: number; json?: unknown };
}) {
  const http = fakeHttp(async (c) => opts.handler(c.url));
  const provider = defineProvider({
    id: opts.providerId,
    displayName: opts.providerId,
    baseUrl: `https://api.${opts.providerId}.test`,
    auth: opts.oauth
      ? oauth2({ authorizationUrl: `https://${opts.providerId}/auth`, tokenUrl: `https://${opts.providerId}/token`, fetch: http.fetch })
      : bearer(),
    ...(opts.identify ? { identify: opts.identify } : {}),
    ...(opts.healthCheck ? { healthCheck: opts.healthCheck } : {}),
  });
  const registry = createRegistry();
  registry.addBundle({ provider, toolkits: [emptyToolkit(opts.providerId)] });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry, store, authRequests: store, secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs(opts.oauth ? [{ id: opts.providerId, providerId: opts.providerId, scheme: 'oauth2', scope: 'global', isDefault: true, oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' }] : []),
    redactor: createRedactor(), approval: { async check() { return 'allow'; } }, fetch: http.fetch,
  });
  return { runtime };
}

describe('testConnection probe selection', () => {
  it('OAuth + identify that needs connect-time ctx (QuickBooks-style): refresh proves liveness → active but UNVERIFIED', async () => {
    const r = rig({
      providerId: 'qbish',
      oauth: true,
      // identify needs a connect-time callback param it can't have at probe time → throws then.
      identify: async (_h, ctx) => {
        if (!ctx.params?.realmId) throw new Error('missing realmId');
        return { accountId: ctx.params.realmId };
      },
      handler: (url) => (url.includes('/token') ? { json: { access_token: 'AT2', refresh_token: 'RT', expires_in: 3600 } } : { json: {} }),
    });
    const begin = await r.runtime.beginAuth('qbish', { scopes: [] });
    const c = await r.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId, params: { realmId: 'R1' } });
    const res = await r.runtime.testConnection(c.id);
    expect(res).toMatchObject({ ok: true, status: 'active', verified: false }); // NOT a false error — the bug this fixes
  });

  it('OAuth + healthCheck success → verified', async () => {
    const r = rig({
      providerId: 'hc',
      oauth: true,
      healthCheck: async (h) => { await h.get('/ping'); },
      handler: (url) => (url.includes('/token') ? { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } } : { json: { ok: true } }),
    });
    const begin = await r.runtime.beginAuth('hc', { scopes: [] });
    const c = await r.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    expect(await r.runtime.testConnection(c.id)).toMatchObject({ ok: true, status: 'active', verified: true });
  });

  it('healthCheck failure is authoritative → error (even on OAuth where refresh succeeded)', async () => {
    const r = rig({
      providerId: 'hcfail',
      oauth: true,
      healthCheck: async (h) => { await h.get('/ping'); },
      handler: (url) => (url.includes('/token') ? { json: { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 } } : { status: 403 }),
    });
    const begin = await r.runtime.beginAuth('hcfail', { scopes: [] });
    const c = await r.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
    expect(await r.runtime.testConnection(c.id)).toMatchObject({ ok: false, status: 'error', verified: false });
  });

  it('non-OAuth with NO probe → active but UNVERIFIED (secret present, unexercised)', async () => {
    const r = rig({ providerId: 'keyonly', handler: () => ({ json: {} }) });
    const c = await r.runtime.connectDirect('keyonly', { credential: { type: 'bearer', token: 't' }, accountId: 'a' });
    expect(await r.runtime.testConnection(c.id)).toMatchObject({ ok: true, status: 'active', verified: false });
  });

  it('non-OAuth identify failure at probe time → error (no refresh to fall back on)', async () => {
    let meStatus = 200; // identify succeeds at connect, then the endpoint goes bad before the probe
    const r = rig({
      providerId: 'keyid',
      identify: async (h) => { await h.get('/me'); return { accountId: 'a' }; },
      handler: (url) => (url.endsWith('/me') ? (meStatus === 200 ? { json: { ok: true } } : { status: 403 }) : { json: {} }),
    });
    const c = await r.runtime.connectDirect('keyid', { credential: { type: 'bearer', token: 't' } });
    meStatus = 403; // identity endpoint now rejects (a non-transient 4xx, not retried)
    expect(await r.runtime.testConnection(c.id)).toMatchObject({ ok: false, status: 'error', verified: false });
  });
});
