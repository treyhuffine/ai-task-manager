/**
 * Pagination primitive (collectPages) + a real provider adoption (Slack conversations.list, whose
 * cursor lives in response_metadata.next_cursor). Proves the bounded multi-page sweep and that an
 * adopting action hides cursor bookkeeping from the caller.
 */
import { describe, it, expect } from 'vitest';
import { collectPages } from '../core/paginate';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { registerSlack } from '../providers/slack';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';

describe('collectPages', () => {
  it('follows the cursor across pages until it is empty', async () => {
    const pages: Record<string, { items: number[]; nextCursor?: string }> = {
      __start: { items: [1, 2], nextCursor: 'b' },
      b: { items: [3, 4], nextCursor: 'c' },
      c: { items: [5], nextCursor: undefined },
    };
    const seen: (string | undefined)[] = [];
    const all = await collectPages<number>(async (cursor) => {
      seen.push(cursor);
      return pages[cursor ?? '__start']!;
    });
    expect(all).toEqual([1, 2, 3, 4, 5]);
    expect(seen).toEqual([undefined, 'b', 'c']); // first call has no cursor
  });

  it('stops and truncates at maxItems', async () => {
    const all = await collectPages<number>(
      async (cursor) => {
        const n = cursor ? Number(cursor) : 0;
        return { items: [n, n + 1], nextCursor: String(n + 2) };
      },
      { maxItems: 5 },
    );
    expect(all).toHaveLength(5);
  });

  it('stops at maxPages even if the provider keeps returning a cursor (runaway backstop)', async () => {
    let calls = 0;
    const all = await collectPages<number>(
      async () => {
        calls++;
        return { items: [calls], nextCursor: 'always' }; // never ends
      },
      { maxPages: 3 },
    );
    expect(calls).toBe(3);
    expect(all).toEqual([1, 2, 3]);
  });

  it('handles a single page (no cursor)', async () => {
    const all = await collectPages<string>(async () => ({ items: ['only'] }));
    expect(all).toEqual(['only']);
  });
});

describe('slack.list_channels auto-pagination (real adoption)', () => {
  it('merges every page; the caller never passes a cursor', async () => {
    const http = fakeHttp(async (c) => {
      if (c.url.includes('oauth.v2.access')) return { json: { ok: true, access_token: 'AT', scope: 'channels:read' } };
      if (c.url.endsWith('/auth.test')) return { json: { ok: true, user_id: 'U1', team_id: 'T1', team: 'Acme', user: 'me' } };
      if (c.url.includes('/conversations.list')) {
        const cursor = new URL(c.url).searchParams.get('cursor');
        if (!cursor) return { json: { ok: true, channels: [{ id: 'C1', name: 'general' }], response_metadata: { next_cursor: 'pg2' } } };
        return { json: { ok: true, channels: [{ id: 'C2', name: 'random' }], response_metadata: { next_cursor: '' } } };
      }
      return { json: { ok: true } };
    });
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
    const begin = await runtime.beginAuth('slack', { scopes: ['channels:read'] });
    await runtime.completeAuth({ code: `code-${begin.requestId}`, state: begin.requestId });

    const out = await runtime.runAction('slack.list_channels', {}); // no cursor — the action pages internally
    expect(out.ok).toBe(true);
    const names = (out as { result: { channels: Array<{ name: string }> } }).result.channels.map((c) => c.name);
    expect(names).toEqual(['general', 'random']); // both pages merged
  });
});
