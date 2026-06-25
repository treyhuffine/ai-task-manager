/**
 * Dropbox connector — OAuth2 connect (offline token), RPC identify, and a couple of actions.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerDropbox } from '../providers/dropbox';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup() {
  const env = {
    action: (_c: FakeHttpCall) => ({ json: {} as unknown }),
  };
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://api.dropboxapi.com/oauth2/token')) {
      return { json: { access_token: 'acc', refresh_token: 'ref', expires_in: 14400, token_type: 'bearer' } };
    }
    if (call.url.includes('/users/get_current_account')) {
      return { json: { account_id: 'dbid:1', email: 'me@dbx.test', name: { display_name: 'Me' } } };
    }
    return env.action(call);
  });
  const registry = createRegistry();
  registerDropbox(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'dropbox', providerId: 'dropbox', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, env, http };
}

async function connect(s: ReturnType<typeof setup>) {
  const begin = await s.runtime.beginAuth('dropbox', { scopes: ['files.metadata.read', 'files.content.write'] });
  return s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
}

describe('dropbox', () => {
  it('connects via OAuth and identifies the account', async () => {
    const s = setup();
    const conn = await connect(s);
    expect(conn.accountId).toBe('dbid:1');
    expect(conn.email).toBe('me@dbx.test');
  });

  it('lists a folder (RPC POST)', async () => {
    const s = setup();
    await connect(s);
    s.env.action = (c) => {
      expect(c.method).toBe('POST');
      expect(c.url).toBe('https://api.dropboxapi.com/2/files/list_folder');
      return { json: { entries: [{ '.tag': 'file', name: 'a.txt' }], has_more: false } };
    };
    const out = await s.runtime.runAction('dropbox.list_folder', { path: '/Documents' });
    expect(out.ok).toBe(true);
    expect((out as { result: { entries: unknown[] } }).result.entries).toHaveLength(1);
  });

  it('creates a folder (mutating, gated then allowed)', async () => {
    const s = setup();
    await connect(s);
    s.env.action = () => ({ json: { metadata: { id: 'id:1', path_display: '/New' } } });
    const out = await s.runtime.runAction('dropbox.create_folder', { path: '/New' });
    expect(out.ok).toBe(true);
    expect((out as { result: { path: string } }).result.path).toBe('/New');
  });
});
