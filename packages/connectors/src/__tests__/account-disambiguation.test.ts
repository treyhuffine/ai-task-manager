/**
 * Account disambiguation round-trips (review finding #1). When the SAME email is connected through
 * two auth configs, the model is shown "me@x.com (Work)" / "(Personal)" — and resolution must
 * accept those exact strings back, instead of looping on needs_account. Covers both the engine
 * resolution (runtime) and that the model-safe choices match what resolution accepts.
 */
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { defineProvider, defineToolkit, httpAction } from '../core/authoring';
import { oauth2 } from '../auth/oauth2';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { Connection } from '../core/types';

const FAR = Date.now() + 1_000_000_000_000;

async function setup() {
  const http = fakeHttp(async () => ({ json: { ok: true } }));
  const provider = defineProvider({
    id: 'svc',
    displayName: 'Svc',
    baseUrl: 'https://api.svc.test',
    auth: oauth2({ authorizationUrl: 'https://svc/auth', tokenUrl: 'https://svc/token', fetch: http.fetch }),
  });
  const toolkit = defineToolkit({
    id: 'svc',
    providerId: 'svc',
    displayName: 'Svc',
    actions: [httpAction({ id: 'svc.act', description: 'act', input: z.object({}), request: () => ({ method: 'GET', path: '/act' }) })],
  });
  const registry = createRegistry();
  registry.addBundle({ provider, toolkits: [toolkit] });
  const store = inMemoryStore();
  const secretBox = plaintextSecretBox();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox,
    authConfigs: staticAuthConfigs([
      { id: 'svc-work', providerId: 'svc', scheme: 'oauth2', scope: 'global', label: 'Work', oauth: { clientId: 'cw', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
      { id: 'svc-personal', providerId: 'svc', scheme: 'oauth2', scope: 'global', label: 'Personal', oauth: { clientId: 'cp', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  // Seed two connections for the SAME email via the two different auth configs.
  const seed = async (id: string, authConfigId: string): Promise<void> => {
    const conn: Connection = {
      id, ownerId: 'local', providerId: 'svc', accountId: `acc-${authConfigId}`, email: 'me@x.com',
      authConfigId, scopes: [], status: 'active', createdAt: 'now', updatedAt: 'now',
    };
    await store.save(conn, await secretBox.seal({ type: 'oauth2', accessToken: 'AT', refreshToken: 'RT', expiresAt: FAR }));
  };
  await seed('c-work', 'svc-work');
  await seed('c-personal', 'svc-personal');
  return { runtime };
}

describe('account disambiguation (duplicate emails across auth configs)', () => {
  it('resolves the disambiguated "email (Label)" token to the right connection', async () => {
    const { runtime } = await setup();
    const work = await runtime.runAction('svc.act', {}, { account: 'me@x.com (Work)' });
    expect(work.ok).toBe(true); // resolved to the Work connection, ran the action
    const personal = await runtime.runAction('svc.act', {}, { account: 'me@x.com (Personal)' });
    expect(personal.ok).toBe(true);
  });

  it('the plain ambiguous email returns needs_account whose choices are the SAME tokens that resolve', async () => {
    const { runtime } = await setup();
    const out = await runtime.runAction('svc.act', {}, { account: 'me@x.com' });
    expect(out.ok).toBe(false);
    expect((out as { reason: string }).reason).toBe('needs_account');

    // The disambiguated choices the host/model sees:
    const choices = await runtime.listAccountChoices('svc');
    const tokens = choices.map((c) => (c.authConfigLabel ? `${c.email} (${c.authConfigLabel})` : c.email));
    expect(tokens.sort()).toEqual(['me@x.com (Personal)', 'me@x.com (Work)']);

    // …and each of those tokens actually resolves (the round-trip the bug broke).
    for (const token of tokens) {
      const res = await runtime.runAction('svc.act', {}, { account: token! });
      expect(res.ok).toBe(true);
    }
  });
});
