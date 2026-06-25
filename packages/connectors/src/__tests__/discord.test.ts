/**
 * Discord connector (OAuth2). Connect via beginAuth→completeAuth (mocked token + /users/@me),
 * then exercise a read and a write through the real runtime.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerDiscord } from '../providers/discord';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';
import type { Connection } from '../core/types';

const RU = 'http://127.0.0.1/cb';

function setup() {
  const env: { action: (call: FakeHttpCall) => { status?: number; json?: unknown } } = {
    action: () => ({ json: {} }),
  };
  const http = fakeHttp(async (call) => {
    if (call.url.startsWith('https://discord.com/api/oauth2/token')) {
      return { json: { access_token: 'acc', refresh_token: 'rt', expires_in: 3600, scope: '' } };
    }
    if (call.url.endsWith('/users/@me')) {
      return { json: { id: 'u1', username: 'tester', global_name: 'Tester', email: 'a@d.test' } };
    }
    return env.action(call);
  });
  const registry = createRegistry();
  registerDiscord(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'discord', providerId: 'discord', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: RU }, clientSecret: 's', status: 'active' },
    ]),
    approval: { async check() { return 'allow'; } },
    redactor: createRedactor(),
    fetch: http.fetch,
  });
  return { runtime, store, http, env };
}

async function connect(s: ReturnType<typeof setup>, scopes: string[]): Promise<Connection> {
  const begin = await s.runtime.beginAuth('discord', { scopes });
  return s.runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
}

describe('discord', () => {
  it('connects via identify and lists guilds', async () => {
    const s = setup();
    const conn = await connect(s, ['identify', 'guilds']);
    expect(conn.accountId).toBe('u1');
    expect(conn.label).toBe('Tester');
    s.env.action = (call) => {
      expect(call.url).toContain('/users/@me/guilds');
      return { json: [{ id: 'g1', name: 'Guild One' }] };
    };
    const out = await s.runtime.runAction('discord.list_guilds', {});
    expect(out.ok).toBe(true);
    expect((out as { result: { guilds: Array<{ id: string }> } }).result.guilds[0]?.id).toBe('g1');
  });

  it('posts a message (mutating, allowed)', async () => {
    const s = setup();
    await connect(s, ['identify', 'guilds', 'messages.read']);
    let body: string | undefined;
    s.env.action = (call) => {
      body = call.body;
      return { json: { id: 'm1' } };
    };
    const out = await s.runtime.runAction('discord.post_message', { channelId: 'c1', content: 'hi there' });
    expect(out.ok).toBe(true);
    expect(body).toContain('hi there');
    expect((out as { result: { id: string } }).result.id).toBe('m1');
  });
});
