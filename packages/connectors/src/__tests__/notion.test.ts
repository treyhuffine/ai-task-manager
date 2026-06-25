/**
 * Notion connector — OAuth2 connect (Basic-auth token endpoint) then actions, and the
 * required Notion-Version header on every call.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerNotion } from '../providers/notion';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { ActionOutcome } from '../core/types';

function setup() {
  const http = fakeHttp(async (call) => {
    if (call.url === 'https://api.notion.com/v1/oauth/token') {
      return { json: { access_token: 'AT', token_type: 'bearer' } };
    }
    if (call.url.endsWith('/users/me')) return { json: { id: 'bot1', name: 'My Bot' } };
    if (call.url.endsWith('/search')) {
      return { json: { results: [{ id: 'p1', object: 'page', properties: { Name: { type: 'title', title: [{ plain_text: 'Hello' }] } } }] } };
    }
    return { json: {} };
  });
  const registry = createRegistry();
  registerNotion(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      { id: 'notion', providerId: 'notion', scheme: 'oauth2', scope: 'global', oauth: { clientId: 'cid', redirectUri: 'http://127.0.0.1/cb' }, clientSecret: 'sec', status: 'active' },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, http };
}

describe('notion connector', () => {
  it('connects (Basic token endpoint) then searches', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('notion', {});
    const conn = await s.runtime.completeAuth({ code: 'c', state: begin.requestId });
    expect(conn.accountId).toBe('bot1');
    expect(conn.label).toBe('My Bot');

    const out = await s.runtime.runAction('notion.search', { query: 'Hello' });
    expect(out.ok).toBe(true);
    const results = (out as Extract<ActionOutcome, { ok: true }>).result as { results: Array<{ id: string; title?: string }> };
    expect(results.results[0]).toMatchObject({ id: 'p1', title: 'Hello' });
  });

  it('sends the Notion-Version header on requests', async () => {
    const s = setup();
    const begin = await s.runtime.beginAuth('notion', {});
    await s.runtime.completeAuth({ code: 'c', state: begin.requestId });
    await s.runtime.runAction('notion.search', {});
    const searchCall = s.http.calls.find((c) => c.url.endsWith('/search'));
    expect(searchCall?.headers['notion-version']).toBe('2022-06-28');
  });
});
