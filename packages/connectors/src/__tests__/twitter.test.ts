/**
 * X (Twitter) connector — OpenAPI-generated toolkit + OAuth2 user-context. Covers the generated
 * action set's shape, the request builder (path fill / JSON body / comma-joined array query),
 * allow/deny trimming (XMCP parity), the chunked `upload_media` helper, scope enforcement, and an
 * end-to-end connect → identify → action run.
 */
import { describe, it, expect } from 'vitest';
import { createConnectorRuntime } from '../core/runtime';
import { createRegistry } from '../core/registry';
import { createRedactor } from '../core/redactor';
import { staticAuthConfigs } from '../auth-configs';
import { inMemoryStore, plaintextSecretBox, fakeHttp } from '../testing';
import type { FakeHttpCall } from '../testing';
import type { ActionContext, AuthedHttp } from '../core/types';
import { registerTwitter } from '../providers/twitter';
import { twitter } from '../providers/twitter/provider';
import { buildTwitterToolkit } from '../providers/twitter/toolkit';
import { TWITTER_OPS, TWITTER_OAUTH_SCOPES } from '../providers/twitter/operations.generated';

const GRANTED = 'tweet.read tweet.write users.read like.write bookmark.write media.write offline.access';

function setup(granted: string = GRANTED) {
  const calls: FakeHttpCall[] = [];
  const http = fakeHttp(async (call) => {
    calls.push(call);
    if (call.url.startsWith('https://api.x.com/2/oauth2/token')) {
      return { json: { access_token: 'AT', refresh_token: 'RT', token_type: 'bearer', expires_in: 7200, scope: granted } };
    }
    if (call.url.endsWith('/2/users/me')) return { json: { data: { id: 'u42', username: 'jack', name: 'Jack' } } };
    if (call.url.includes('/2/users/by/username/')) return { json: { data: { id: 'u7', username: 'TwitterDev' } } };
    if (call.url.endsWith('/2/tweets') && call.method === 'POST') return { json: { data: { id: 't1', text: 'hello' } } };
    if (call.url.includes('/likes') && call.method === 'POST') return { json: { data: { liked: true } } };
    if (call.url.endsWith('/2/media/upload/initialize')) return { json: { data: { id: 'media-123' } } };
    if (call.url.includes('/append')) return { json: { data: {} } };
    if (call.url.includes('/finalize')) return { json: { data: { id: 'media-123', media_key: '7_media-123' } } };
    return { json: { data: {} } };
  });
  const registry = createRegistry();
  registerTwitter(registry, { fetch: http.fetch });
  const store = inMemoryStore();
  const runtime = createConnectorRuntime({
    registry,
    store,
    authRequests: store,
    secretBox: plaintextSecretBox(),
    authConfigs: staticAuthConfigs([
      {
        id: 'twitter',
        providerId: 'twitter',
        scheme: 'oauth2',
        scope: 'global',
        oauth: { clientId: 'c', redirectUri: 'http://127.0.0.1/cb' },
        clientSecret: 's',
        status: 'active',
      },
    ]),
    redactor: createRedactor(),
    approval: { async check() { return 'allow'; } },
    fetch: http.fetch,
  });
  return { runtime, calls };
}

async function connect(runtime: ReturnType<typeof setup>['runtime'], scopes: string = GRANTED) {
  const begin = await runtime.beginAuth('twitter', { scopes: scopes.split(' ') });
  return runtime.completeAuth({ code: 'code', state: begin.requestId });
}

describe('twitter — generated toolkit shape', () => {
  it('builds the full action set plus the upload helper, all uniquely `twitter.`-prefixed', () => {
    const tk = buildTwitterToolkit();
    expect(tk.actions.length).toBe(TWITTER_OPS.length + 1); // + twitter.upload_media
    expect(tk.actions.length).toBeGreaterThan(100);
    const ids = tk.actions.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length); // unique
    expect(ids.every((id) => id.startsWith('twitter.'))).toBe(true);
    expect(ids).toContain('twitter.upload_media');
  });

  it('GET actions are non-mutating/low risk; writes are mutating; DELETEs are high risk', () => {
    for (const op of TWITTER_OPS) {
      if (op.method === 'GET') {
        expect(op.mutating).toBe(false);
        expect(op.risk).toBe('low');
      } else {
        expect(op.mutating).toBe(true);
      }
      if (op.method === 'DELETE') expect(op.risk).toBe('high');
    }
  });

  it('excludes streaming/webhook operations (XMCP parity)', () => {
    expect(TWITTER_OPS.some((o) => o.path.includes('/stream'))).toBe(false);
    expect(TWITTER_OPS.some((o) => o.path.includes('/webhooks'))).toBe(false);
  });

  it('surfaces the OAuth2 scope union (read + write)', () => {
    expect(TWITTER_OAUTH_SCOPES).toContain('tweet.read');
    expect(TWITTER_OAUTH_SCOPES).toContain('tweet.write');
    expect(TWITTER_OAUTH_SCOPES).toContain('users.read');
  });

  it('trims by allowlist / denylist (operationId or action id)', () => {
    const allow = buildTwitterToolkit({ allowlist: ['createPosts', 'twitter.get_users_by_username'] });
    expect(allow.actions.map((a) => a.id).sort()).toEqual(['twitter.create_posts', 'twitter.get_users_by_username']);

    const deny = buildTwitterToolkit({ denylist: ['createPosts'] });
    expect(deny.actions.some((a) => a.id === 'twitter.create_posts')).toBe(false);
    expect(deny.actions.length).toBe(TWITTER_OPS.length); // -1 generated (createPosts), +1 upload helper

    const denyUpload = buildTwitterToolkit({ denylist: ['uploadMedia'] });
    expect(denyUpload.actions.some((a) => a.id === 'twitter.upload_media')).toBe(false);
  });

  it('trims by tag (XMCP X_API_TOOL_TAGS parity)', () => {
    const bookmarks = buildTwitterToolkit({ tags: ['Bookmarks'] });
    expect(bookmarks.actions.length).toBeGreaterThan(0);
    expect(
      bookmarks.actions.every((a) => TWITTER_OPS.find((o) => o.id === a.id)?.tags.includes('Bookmarks')),
    ).toBe(true);
    expect(bookmarks.actions.some((a) => a.id === 'twitter.upload_media')).toBe(false); // not a bookmark op

    const media = buildTwitterToolkit({ tags: ['Media'] }); // the helper rides the Media tag
    expect(media.actions.some((a) => a.id === 'twitter.upload_media')).toBe(true);
  });

  it('reconstructs path params + JSON body for a generated action (request builder)', async () => {
    // chat_media_download has TWO path params — exercise multi-placeholder substitution directly.
    const act = buildTwitterToolkit().actions.find((a) => a.id === 'twitter.chat_media_download');
    expect(act).toBeTruthy();
    let captured: { method: string; path: string } | undefined;
    const ctx = {
      config: {},
      http: { async request(req: { method: string; path: string }) { captured = req; return {}; } },
    } as unknown as ActionContext;
    await act!.execute(ctx, { id: 'A1', media_hash_key: 'B2' });
    expect(captured?.method).toBe('GET');
    expect(captured?.path).toBe('/2/chat/media/A1/B2');
  });
});

describe('twitter — provider', () => {
  it('is an OAuth2 provider with the X endpoints and refresh-enabling identity scopes', () => {
    const p = twitter();
    expect(p.id).toBe('twitter');
    expect(p.baseUrl).toBe('https://api.x.com');
    expect(p.auth.kind).toBe('oauth2');
    expect(p.identityScopes).toContain('offline.access'); // required for X to issue a refresh token
    expect(p.identityScopes).toContain('users.read');
  });

  it('identify throws when /2/users/me returns no id', async () => {
    const p = twitter();
    const http = { async get() { return { data: {} }; } } as unknown as AuthedHttp;
    await expect(p.identify!(http, {})).rejects.toThrow(/no id/);
  });
});

describe('twitter — end to end', () => {
  it('connects via OAuth2 and identifies the account from /2/users/me', async () => {
    const s = setup();
    const conn = await connect(s.runtime);
    expect(conn.accountId).toBe('u42');
    expect(conn.label).toBe('@jack');
    const tokenCall = s.calls.find((c) => c.url.startsWith('https://api.x.com/2/oauth2/token'));
    expect(tokenCall?.headers.authorization?.startsWith('Basic ')).toBe(true); // confidential client
  });

  it('posts a tweet — POST /2/tweets with a JSON body assembled from body params', async () => {
    const s = setup();
    await connect(s.runtime);
    const out = await s.runtime.runAction('twitter.create_posts', { text: 'hello' });
    expect(out.ok).toBe(true);
    const call = s.calls.find((c) => c.url.endsWith('/2/tweets') && c.method === 'POST');
    expect(JSON.parse(call!.body ?? '{}')).toEqual({ text: 'hello' });
    expect(call!.headers.authorization).toBe('Bearer AT');
  });

  it('fills path params and comma-joins array query params (explode:false)', async () => {
    const s = setup();
    await connect(s.runtime);
    await s.runtime.runAction('twitter.get_users_by_username', {
      username: 'TwitterDev',
      'user.fields': ['id', 'username', 'verified'],
    });
    const call = s.calls.find((c) => c.url.includes('/2/users/by/username/'));
    const url = new URL(call!.url);
    expect(url.pathname).toBe('/2/users/by/username/TwitterDev');
    expect(url.searchParams.get('user.fields')).toBe('id,username,verified');
  });

  it('routes a path param into the URL and a body param into JSON (likePost)', async () => {
    const s = setup();
    await connect(s.runtime);
    const out = await s.runtime.runAction('twitter.like_post', { id: 'u42', tweet_id: 't1' });
    expect(out.ok).toBe(true);
    const call = s.calls.find((c) => c.url.includes('/likes') && c.method === 'POST');
    expect(new URL(call!.url).pathname).toBe('/2/users/u42/likes');
    expect(JSON.parse(call!.body ?? '{}')).toEqual({ tweet_id: 't1' });
  });

  it('uploads media in one call: init (total_bytes) → append → finalize → media id', async () => {
    const s = setup();
    await connect(s.runtime);
    const raw = 'hello-image-bytes';
    const out = await s.runtime.runAction('twitter.upload_media', {
      media: Buffer.from(raw).toString('base64'),
      media_type: 'image/png',
      media_category: 'tweet_image',
    });
    expect(out.ok).toBe(true);
    expect((out as { result: { id: string } }).result.id).toBe('media-123');

    const init = s.calls.find((c) => c.url.endsWith('/2/media/upload/initialize'));
    expect(JSON.parse(init!.body ?? '{}')).toMatchObject({
      media_type: 'image/png',
      total_bytes: Buffer.byteLength(raw),
      media_category: 'tweet_image',
    });
    const appends = s.calls.filter((c) => c.url.includes('/append'));
    expect(appends.length).toBe(1);
    expect(JSON.parse(appends[0]!.body ?? '{}').segment_index).toBe(0);
    expect(s.calls.some((c) => c.url.includes('/media/upload/media-123/finalize'))).toBe(true);
  });

  it('denies a write action when the granted scopes lack it (trust spine)', async () => {
    const s = setup('tweet.read users.read offline.access'); // no tweet.write
    await connect(s.runtime, 'tweet.read users.read offline.access');
    const blocked = await s.runtime.runAction('twitter.create_posts', { text: 'nope' });
    expect(blocked).toMatchObject({ ok: false, reason: 'needs_consent' });
    expect(s.calls.some((c) => c.url.endsWith('/2/tweets') && c.method === 'POST')).toBe(false);
  });
});

describe('twitter — chunked upload', () => {
  it('splits media into segments and the reassembled chunks equal the original bytes', async () => {
    const original = Buffer.from('0123456789abcdefghijKLMNOPQRSTUVWXYZ'); // 36 bytes
    const tk = buildTwitterToolkit({ mediaChunkBytes: 8 }); // → 5 segments (8,8,8,8,4)
    const act = tk.actions.find((a) => a.id === 'twitter.upload_media')!;

    const appends: Array<{ segment_index: number; media: string }> = [];
    let initBody: Record<string, unknown> = {};
    const ctx = {
      config: {},
      http: {
        async post(path: string, body: Record<string, unknown>) {
          if (path.endsWith('/initialize')) { initBody = body; return { data: { id: 'm1' } }; }
          if (path.includes('/append')) { appends.push(body as { segment_index: number; media: string }); return { data: {} }; }
          if (path.includes('/finalize')) return { data: { id: 'm1' } };
          return { data: {} };
        },
      },
    } as unknown as ActionContext;

    const out = (await act.execute(ctx, { media: original.toString('base64'), media_type: 'video/mp4' })) as { id: string };
    expect(out.id).toBe('m1');
    expect(initBody).toMatchObject({ total_bytes: original.length, media_type: 'video/mp4' });
    expect(appends.map((a) => a.segment_index)).toEqual([0, 1, 2, 3, 4]);
    const reassembled = Buffer.concat(appends.map((a) => Buffer.from(a.media, 'base64')));
    expect(reassembled.equals(original)).toBe(true);
  });

  it('rejects empty media before calling the API', async () => {
    const act = buildTwitterToolkit().actions.find((a) => a.id === 'twitter.upload_media')!;
    let called = false;
    const ctx = { config: {}, http: { async post() { called = true; return {}; } } } as unknown as ActionContext;
    await expect(act.execute(ctx, { media: '', media_type: 'image/png' })).rejects.toThrow(/empty/);
    expect(called).toBe(false);
  });
});
