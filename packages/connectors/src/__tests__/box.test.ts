/**
 * Box connector — OAuth2 connect (fake token + /users/me identify), then folder/search/create.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerBox } from '../providers/box';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';
import type { ActionOutcome, Connection } from '../core/types';

function setup() {
  const env = { action: (_c: FakeHttpCall) => ({ json: {} as unknown }) };
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://api.box.com/oauth2/token')) {
      return { json: { access_token: 'acc', refresh_token: 'ref', expires_in: 3600, scope: '' } };
    }
    if (call.url.endsWith('/users/me')) {
      return { json: { id: 123, login: 'me@box.com', name: 'Me' } };
    }
    return env.action(call);
  });
  const registry = createRegistry();
  registerBox(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'box', providerId: 'box', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, env };
}

async function connect(s: ReturnType<typeof setup>): Promise<Connection> {
  const begin = await s.runtime.beginAuth('box', { scopes: [] });
  return s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
}

describe('box', () => {
  it('connects via OAuth and identifies the account', async () => {
    const s = setup();
    const conn = await connect(s);
    expect(conn.accountId).toBe('123');
    expect(conn.email).toBe('me@box.com');
  });

  it('lists folder items', async () => {
    const s = setup();
    await connect(s);
    s.env.action = () => ({ json: { entries: [{ id: '1', name: 'report.pdf', type: 'file', size: 10 }] } });
    const out = await s.runtime.runAction('box.list_folder_items', { folderId: '0' });
    expect(out.ok).toBe(true);
    const r = (out as Extract<ActionOutcome, { ok: true }>).result as { entries: unknown[] };
    expect(r.entries).toHaveLength(1);
  });

  it('creates a folder (mutating)', async () => {
    const s = setup();
    await connect(s);
    let body: string | undefined;
    s.env.action = (c) => {
      body = c.body;
      return { json: { id: '99', name: 'New', type: 'folder' } };
    };
    const out = await s.runtime.runAction('box.create_folder', { name: 'New' });
    expect(out.ok).toBe(true);
    expect(JSON.parse(body as string)).toMatchObject({ name: 'New', parent: { id: '0' } });
  });
});
