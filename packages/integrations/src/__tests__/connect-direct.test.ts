/**
 * connectDirect — the non-OAuth credential connect path. Proves identify() runs, the
 * credential shape is validated against the provider, dedup works, and actions then run.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createIntegrationRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { defineProvider, defineToolkit, httpAction } from '../core/authoring';
import { apiKey } from '../auth/direct';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { AuthedHttp } from '../core/types';

function setup(opts: { rejectKey?: boolean; authorizationRequired?: (r: { providerId: string; existingConnectionId?: string }) => string } = {}) {
  const calls: string[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call.url);
    if (call.url.endsWith('/me')) return { json: { id: 'u1', email: 'a@svc.test' } };
    if (opts.rejectKey) return { status: 401, json: { error: 'invalid token' } };
    return { json: { ok: true } };
  });
  const provider = defineProvider({
    id: 'svc',
    displayName: 'Svc',
    baseUrl: 'https://api.svc.test',
    auth: apiKey({ prefix: 'Bearer ' }),
    identify: async (h: AuthedHttp) => {
      const me = await h.get<{ id: string; email: string }>('/me');
      return { accountId: me.id, email: me.email, label: me.email };
    },
  });
  const toolkit = defineToolkit({
    id: 'svc',
    providerId: 'svc',
    displayName: 'Svc',
    actions: [httpAction({ id: 'svc.ping', description: 'ping', input: z.object({}), request: () => ({ method: 'GET', path: '/ping' }) })],
  });
  const registry = createRegistry();
  registry.addBundle({ provider, toolkits: [toolkit] });
  const store = inMemoryStore();
  const runtime = createIntegrationRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
    ...(opts.authorizationRequired ? { authorizationRequired: opts.authorizationRequired } : {}),
  });
  return { runtime, store, http, calls };
}

describe('connectDirect', () => {
  it('runs identify(), stores the connection, and actions then work', async () => {
    const s = setup();
    const conn = await s.runtime.connectDirect('svc', { credential: { type: 'api_key', apiKey: 'KEY' } });
    expect(conn.accountId).toBe('u1');
    expect(conn.email).toBe('a@svc.test');
    expect(conn.scopes).toEqual([]);
    const out = await s.runtime.runAction('svc.ping', {});
    expect(out.ok).toBe(true);
    expect(s.calls.some((u) => u.endsWith('/ping'))).toBe(true);
  });

  it('dedups by identified account (re-adding the same key upgrades in place)', async () => {
    const s = setup();
    const a = await s.runtime.connectDirect('svc', { credential: { type: 'api_key', apiKey: 'KEY' } });
    const b = await s.runtime.connectDirect('svc', { credential: { type: 'api_key', apiKey: 'KEY2' } });
    expect(b.id).toBe(a.id); // same identified account → one connection
    expect((await s.store.list({ providerId: 'svc' })).length).toBe(1);
  });

  it('rejects a credential whose shape does not match the provider strategy', async () => {
    const s = setup();
    await expect(
      s.runtime.connectDirect('svc', { credential: { type: 'bearer', token: 'x' } }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('fails fast on an explicit authConfigId that does not resolve (never stamps a phantom id)', async () => {
    const s = setup();
    await expect(
      s.runtime.connectDirect('svc', { credential: { type: 'api_key', apiKey: 'KEY' }, authConfigId: 'does-not-exist' }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
    expect((await s.store.list({ providerId: 'svc' })).length).toBe(0); // nothing persisted
  });

  it('a rejected key asks the person to enter it again, through the host landing page', async () => {
    const s = setup({
      rejectKey: true,
      authorizationRequired: (r) => `https://app.test/connect?provider=${r.providerId}&connection=${r.existingConnectionId}`,
    });
    const conn = await s.runtime.connectDirect('svc', { credential: { type: 'api_key', apiKey: 'WRONG' } });
    const out = await s.runtime.runAction('svc.ping', {});
    expect(out).toMatchObject({
      ok: false,
      reason: 'auth_required',
      providerId: 'svc',
      authorizationUrl: `https://app.test/connect?provider=svc&connection=${conn.id}`,
    });
  });

  it('without a host landing page, a rejected key stays provider_not_configured', async () => {
    const s = setup({ rejectKey: true });
    await s.runtime.connectDirect('svc', { credential: { type: 'api_key', apiKey: 'WRONG' } });
    expect(await s.runtime.runAction('svc.ping', {})).toMatchObject({ ok: false, reason: 'error', code: 'provider_not_configured' });
  });
});
