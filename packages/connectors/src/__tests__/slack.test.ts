/** Slack connector — OAuth2 connect (beginAuth→completeAuth, identify auth.test), then actions. */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { registerSlack } from '../providers/slack';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';

function setup(handler: (c: FakeHttpCall) => { status?: number; json?: unknown }) {
  const http = fakeHttp(async (c) => handler(c));
  const registry = createRegistry();
  registerSlack(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'slack', providerId: 'slack', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 's', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime };
}

const SLACK_SCOPES = ['channels:read', 'chat:write', 'search:read', 'channels:history', 'users:read'];

async function connect(runtime: ReturnType<typeof setup>['runtime']) {
  const begin = await runtime.beginAuth('slack', { scopes: SLACK_SCOPES });
  return runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });
}

describe('slack', () => {
  it('connects via OAuth and lists channels', async () => {
    const s = setup((c) => {
      if (c.url.startsWith('https://slack.com/api/oauth.v2.access')) return { json: { ok: true, access_token: 'xoxb-TEST' } };
      if (c.url.includes('/auth.test')) return { json: { ok: true, user_id: 'U1', team_id: 'T1', user: 'me', team: 'Acme' } };
      if (c.url.includes('/conversations.list')) return { json: { ok: true, channels: [{ id: 'C1', name: 'general', is_private: false }] } };
      return { json: { ok: true } };
    });
    const conn = await connect(s.runtime);
    expect(conn.accountId).toBe('T1:U1');
    const out = await s.runtime.runAction('slack.list_channels', {});
    expect(out.ok).toBe(true);
    expect((out as { result: { channels: Array<{ name: string }> } }).result.channels[0]?.name).toBe('general');
  });

  it('maps a Slack {ok:false} body to a provider_error', async () => {
    const s = setup((c) => {
      if (c.url.startsWith('https://slack.com/api/oauth.v2.access')) return { json: { ok: true, access_token: 'xoxb' } };
      if (c.url.includes('/auth.test')) return { json: { ok: true, user_id: 'U1', team_id: 'T1' } };
      if (c.url.includes('/chat.postMessage')) return { json: { ok: false, error: 'channel_not_found' } };
      return { json: { ok: true } };
    });
    await connect(s.runtime);
    const out = await s.runtime.runAction('slack.post_message', { channel: 'bad', text: 'hi' });
    expect(out).toMatchObject({ ok: false, reason: 'error', code: 'provider_error' });
  });
});
