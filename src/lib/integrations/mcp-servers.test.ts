import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { mcpServerStore, toSlug, type McpServerStore } from './mcp-servers';
import { validateMcpUrl, validateHeaderName } from './mcp-validate';
import { fileLock } from '@integrations/engine';

// Passthrough seal/open + no-op lock — exercises the store without the engine crypto/lock.
const fakeSecretBox = {
  seal: async (v: unknown) => v,
  open: async <T,>(s: unknown) => s as T,
};
const noopLock = { withLock: async <T,>(_n: string, fn: () => Promise<T>) => fn() };

const dirs: string[] = [];
function freshStore(): McpServerStore {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-store-'));
  dirs.push(dir);
  return mcpServerStore({ dir, secretBox: fakeSecretBox, lock: noopLock });
}

afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe('mcpServerStore', () => {
  it('creates, lists, and reads back by slug', async () => {
    const store = freshStore();
    const entry = await store.create({ slug: 'sentry', displayName: 'Sentry', url: 'https://mcp.sentry.io', auth: { kind: 'none' } });
    expect(entry.slug).toBe('sentry');
    expect(store.list()).toHaveLength(1);
    expect(store.getBySlug('sentry')?.id).toBe(entry.id);
    expect(store.get(entry.id)?.displayName).toBe('Sentry');
  });

  it('seals + reads back the auth secret', async () => {
    const store = freshStore();
    const entry = await store.create(
      { slug: 'acme', displayName: 'Acme', url: 'https://mcp.acme.dev', auth: { kind: 'bearer' } },
      'super-secret-token',
    );
    expect(await store.openSecret(entry.id)).toBe('super-secret-token');
  });

  it('rejects a duplicate slug', async () => {
    const store = freshStore();
    await store.create({ slug: 'dup', displayName: 'One', url: 'https://a.example', auth: { kind: 'none' } });
    await expect(
      store.create({ slug: 'dup', displayName: 'Two', url: 'https://b.example', auth: { kind: 'none' } }),
    ).rejects.toMatchObject({ code: 'slug_taken' });
  });

  it('updates displayName + enabled but not slug, and can clear the secret', async () => {
    const store = freshStore();
    const e = await store.create(
      { slug: 'edit', displayName: 'Old', url: 'https://x.example', auth: { kind: 'bearer' } },
      'tok',
    );
    const updated = await store.update(e.id, { displayName: 'New', enabled: false, secret: null });
    expect(updated?.displayName).toBe('New');
    expect(updated?.enabled).toBe(false);
    expect(updated?.slug).toBe('edit'); // immutable
    expect(await store.openSecret(e.id)).toBeNull(); // cleared
  });

  it('keeps the secret when patch.secret is undefined', async () => {
    const store = freshStore();
    const e = await store.create(
      { slug: 'keep', displayName: 'Keep', url: 'https://x.example', auth: { kind: 'bearer' } },
      'tok',
    );
    await store.update(e.id, { displayName: 'Renamed' });
    expect(await store.openSecret(e.id)).toBe('tok');
  });

  it('records health and removes', async () => {
    const store = freshStore();
    const e = await store.create({ slug: 'h', displayName: 'H', url: 'https://x.example', auth: { kind: 'none' } });
    await store.setHealth(e.id, { lastStatus: 'ok', lastToolCount: 7, lastCheckedAt: '2026-06-24T00:00:00Z' });
    expect(store.get(e.id)?.lastStatus).toBe('ok');
    expect(store.get(e.id)?.lastToolCount).toBe(7);
    expect(await store.remove(e.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
  });

  it('publishes exact completed consent without overwriting health or discovered tools', async () => {
    const store = freshStore();
    const entry = await store.create({ slug: 'completed-auth', displayName: 'Auth', url: 'https://example.com', auth: { kind: 'oauth' } });
    const health = { lastStatus: 'ok' as const, lastToolCount: 2, lastCheckedAt: '2026-09-28T00:00:00Z', tools: [{ name: 'first' }, { name: 'second' }] };
    await store.setHealth(entry.id, health);
    await store.setOAuthState(entry.id, { authorizationState: 'consent', authorizationExpiresAt: 2000, tokens: { access_token: 'new' } });
    const id = createHash('sha256').update('consent').digest('hex');
    expect(await store.completeAuthorization(entry.id, id)).toBe(false);
    expect(await store.consumeOAuthState(entry.id, 'consent', 1000)).toBe(true);
    const before = store.get(entry.id)!;
    expect(await store.completeAuthorization(entry.id, id)).toBe(true);
    expect(store.get(entry.id)).toEqual({ ...before, lastAuthorizationId: id });
    await store.setHealth(entry.id, { ...health, lastToolCount: 3 });
    expect(store.get(entry.id)?.lastAuthorizationId).toBe(id);
  });

  it('seals + reads back OAuth state, separate from the static secret slot', async () => {
    const store = freshStore();
    const e = await store.create({ slug: 'oa', displayName: 'OA', url: 'https://mcp.example', auth: { kind: 'oauth' } });
    expect(await store.getOAuthState(e.id)).toBeNull();
    await store.setOAuthState(e.id, {
      clientInformation: { client_id: 'abc' },
      tokens: { access_token: 'tok' },
      codeVerifier: 'verifier',
    });
    const st = await store.getOAuthState(e.id);
    expect(st?.codeVerifier).toBe('verifier');
    expect((st?.tokens as { access_token?: string })?.access_token).toBe('tok');
    expect(await store.openSecret(e.id)).toBeNull(); // OAuth state is distinct from the static secret
  });
});

describe('toSlug', () => {
  it('sanitizes to a stable id-safe slug', () => {
    expect(toSlug('My Cool Server!')).toBe('my_cool_server');
    expect(toSlug('  spaced  ')).toBe('spaced');
    expect(toSlug('café/123')).toBe('caf_123');
  });
});

describe('durable tool capability review', () => {
  it('makes first discovery the baseline and reports cumulative changes until reviewed', async () => {
    const store = freshStore();
    const entry = await store.create({ slug: 'capabilities', displayName: 'Capabilities', url: 'https://example.com', auth: { kind: 'none' } });
    const first = await store.recordCapabilities(entry.id, [{ name: 'original', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]);
    expect(first?.capabilityRevision).toHaveLength(64);
    expect(first?.capabilityChanges).toBeUndefined();
    await store.recordCapabilities(entry.id, [{ name: 'new' }]);
    const latest = await store.recordCapabilities(entry.id, [{ name: 'original', inputSchema: { type: 'string' }, annotations: { readOnlyHint: false } }, { name: 'latest' }]);
    expect(latest?.capabilityChanges).toEqual({ revision: latest?.capabilityRevision, added: ['latest'], removed: [], changed: [{ name: 'original', fields: ['inputSchema', 'annotations'] }] });
    const reopened = mcpServerStore({ dir: dirs.at(-1)!, secretBox: fakeSecretBox, lock: noopLock });
    expect(reopened.get(entry.id)?.capabilityChanges).toEqual(latest?.capabilityChanges);
    const rows = JSON.parse(fs.readFileSync(path.join(dirs.at(-1)!, 'mcp-servers.json'), 'utf8'));
    expect(rows[0].capabilities.reviewed.tools[0].inputSchema).toEqual({ type: 'object' });
  });

  it('rejects stale acknowledgement and advances only the exact reviewed revision', async () => {
    const store = freshStore();
    const entry = await store.create({ slug: 'review', displayName: 'Review', url: 'https://example.com', auth: { kind: 'none' } });
    await store.recordCapabilities(entry.id, []);
    const previous = (await store.recordCapabilities(entry.id, [{ name: 'first' }]))!;
    const latest = (await store.recordCapabilities(entry.id, [{ name: 'second' }]))!;
    await expect(store.acknowledgeCapabilities(entry.id, previous.capabilityRevision!)).rejects.toMatchObject({ code: 'conflict' });
    expect(store.get(entry.id)?.capabilityChanges).toEqual(latest.capabilityChanges);
    expect((await store.acknowledgeCapabilities(entry.id, latest.capabilityRevision!))?.capabilityChanges).toBeUndefined();
    expect((await store.acknowledgeCapabilities(entry.id, latest.capabilityRevision!))?.capabilityChanges).toBeUndefined();
    const next = await store.recordCapabilities(entry.id, []);
    expect(next?.capabilityChanges?.removed).toEqual(['second']);
  });

  it('clears unreviewed changes if the vendor returns to the reviewed inventory', async () => {
    const store = freshStore();
    const entry = await store.create({ slug: 'reverted', displayName: 'Reverted', url: 'https://example.com', auth: { kind: 'none' } });
    await store.recordCapabilities(entry.id, [{ name: 'read' }]);
    await store.recordCapabilities(entry.id, [{ name: 'write' }]);
    expect((await store.recordCapabilities(entry.id, [{ name: 'read' }]))?.capabilityChanges).toBeUndefined();
  });

  it('does not recreate deleted server authority from a late discovery or acknowledgement', async () => {
    const store = freshStore();
    const entry = await store.create({ slug: 'gone', displayName: 'Gone', url: 'https://example.com', auth: { kind: 'none' } });
    await store.remove(entry.id);
    expect(await store.recordCapabilities(entry.id, [{ name: 'late' }])).toBeNull();
    expect(await store.acknowledgeCapabilities(entry.id, 'late')).toBeNull();
    expect(store.list()).toEqual([]);
  });

  it('never acknowledges a concurrent newer inventory across processes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-review-lock-'));
    dirs.push(dir);
    const makeStore = () => mcpServerStore({ dir, secretBox: fakeSecretBox, lock: fileLock({ dir: path.join(dir, 'locks'), retryMs: 1 }) });
    const discovery = makeStore();
    const reviewer = makeStore();
    const entry = await discovery.create({ slug: 'concurrent-review', displayName: 'Concurrent', url: 'https://example.com', auth: { kind: 'none' } });
    await discovery.recordCapabilities(entry.id, [{ name: 'baseline' }]);
    const displayed = (await discovery.recordCapabilities(entry.id, [{ name: 'displayed' }]))!;
    const [recorded, acknowledged] = await Promise.allSettled([
      discovery.recordCapabilities(entry.id, [{ name: 'newer' }]),
      reviewer.acknowledgeCapabilities(entry.id, displayed.capabilityRevision!),
    ]);
    expect(recorded.status).toBe('fulfilled');
    if (acknowledged.status === 'rejected') expect(acknowledged.reason).toMatchObject({ code: 'conflict' });
    const current = reviewer.get(entry.id)!;
    expect(current.capabilityRevision).not.toBe(displayed.capabilityRevision);
    expect(current.capabilityChanges?.added).toEqual(['newer']);
    expect(current.capabilityChanges?.revision).toBe(current.capabilityRevision);
  });

  it('reviews each account independently even when tool definitions match', async () => {
    const store = freshStore();
    const first = await store.create({ slug: 'first-account', displayName: 'First', url: 'https://example.com', auth: { kind: 'none' } });
    const second = await store.create({ slug: 'second-account', displayName: 'Second', url: 'https://example.com', auth: { kind: 'none' } });
    for (const entry of [first, second]) {
      await store.recordCapabilities(entry.id, []);
      await store.recordCapabilities(entry.id, [{ name: 'write' }]);
    }
    const revision = store.get(first.id)!.capabilityRevision!;
    await store.acknowledgeCapabilities(first.id, revision);
    expect(store.get(first.id)?.capabilityChanges).toBeUndefined();
    expect(store.get(second.id)?.capabilityChanges).toEqual({ revision, added: ['write'], removed: [], changed: [] });
  });
});

describe('validateMcpUrl', () => {
  it('accepts https and localhost http, rejects remote http + garbage', () => {
    expect(validateMcpUrl('https://mcp.example.com').ok).toBe(true);
    expect(validateMcpUrl('http://localhost:7000/mcp').ok).toBe(true);
    expect(validateMcpUrl('http://evil.example.com').ok).toBe(false);
    expect(validateMcpUrl('not a url').ok).toBe(false);
    expect(validateMcpUrl('').ok).toBe(false);
  });
});

describe('validateHeaderName', () => {
  it('accepts simple header names, rejects CRLF/garbage', () => {
    expect(validateHeaderName('X-API-Key')).toBe(true);
    expect(validateHeaderName('Authorization')).toBe(true);
    expect(validateHeaderName('bad header')).toBe(false);
    expect(validateHeaderName('inject\r\nHost')).toBe(false);
    expect(validateHeaderName('')).toBe(false);
  });
});

it('consumes matching unexpired OAuth state once and preserves the PKCE verifier', async () => {
  const store = freshStore();
  const entry = await store.create({ slug: 'oauth', displayName: 'OAuth', url: 'https://mcp.example', auth: { kind: 'oauth' } });
  await store.setOAuthState(entry.id, { authorizationState: 'nonce', authorizationExpiresAt: 2000, codeVerifier: 'verifier' });
  expect(await store.consumeOAuthState(entry.id, 'wrong', 1000)).toBe(false);
  expect(await store.consumeOAuthState(entry.id, 'nonce', 2000)).toBe(false);
  expect(await store.consumeOAuthState(entry.id, 'nonce', 1000)).toBe(true);
  expect(await store.consumeOAuthState(entry.id, 'nonce', 1000)).toBe(false);
  expect(await store.getOAuthState(entry.id)).toEqual({ codeVerifier: 'verifier', revision: expect.any(String), consumedAuthorizationId: createHash('sha256').update('nonce').digest('hex') });
});

it('cannot overwrite newer consent completion with an older callback', async () => {
  const store = freshStore();
  const entry = await store.create({ slug: 'overlapping-consent', displayName: 'OAuth', url: 'https://mcp.example', auth: { kind: 'oauth' } });
  await store.setHealth(entry.id, { lastStatus: 'ok', lastToolCount: 7, lastCheckedAt: '2026-09-28T00:00:00Z' });
  const firstId = createHash('sha256').update('first').digest('hex');
  const secondId = createHash('sha256').update('second').digest('hex');
  await store.setOAuthState(entry.id, { authorizationState: 'first', authorizationExpiresAt: 2000, tokens: { access_token: 'first-token' } });
  expect(await store.consumeOAuthState(entry.id, 'first', 1000)).toBe(true);
  await store.setOAuthState(entry.id, { ...(await store.getOAuthState(entry.id)), authorizationState: 'second', authorizationExpiresAt: 2000 });
  expect(await store.completeAuthorization(entry.id, firstId)).toBe(false);
  expect(store.get(entry.id)?.lastAuthorizationId).toBeUndefined();
  expect(await store.consumeOAuthState(entry.id, 'second', 1000)).toBe(true);
  await store.setOAuthState(entry.id, { ...(await store.getOAuthState(entry.id)), tokens: { access_token: 'second-token' } });
  expect(await store.completeAuthorization(entry.id, secondId)).toBe(true);
  expect(await store.completeAuthorization(entry.id, firstId)).toBe(false);
  expect(store.get(entry.id)).toMatchObject({ lastAuthorizationId: secondId, lastStatus: 'ok', lastToolCount: 7, lastCheckedAt: '2026-09-28T00:00:00Z' });
});

it.each(['disabled', 'no tokens', 'unhealthy', 'not oauth', 'deleted'])('does not publish consent completion for an account that is %s', async failure => {
  const store = freshStore();
  const entry = await store.create({ slug: 'completion-guard', displayName: 'OAuth', url: 'https://mcp.example', auth: { kind: 'oauth' } });
  await store.setHealth(entry.id, { lastStatus: 'ok', lastCheckedAt: '2026-09-28T00:00:00Z' });
  await store.setOAuthState(entry.id, { authorizationState: 'consent', authorizationExpiresAt: 2000, tokens: { access_token: 'token' } });
  await store.consumeOAuthState(entry.id, 'consent', 1000);
  const id = createHash('sha256').update('consent').digest('hex');
  if (failure === 'disabled') await store.update(entry.id, { enabled: false });
  if (failure === 'no tokens') await store.setOAuthState(entry.id, { ...(await store.getOAuthState(entry.id)), tokens: undefined });
  if (failure === 'unhealthy') await store.setHealth(entry.id, { lastStatus: 'unreachable', lastError: 'Discovery failed', lastCheckedAt: '2026-09-28T00:00:01Z' });
  if (failure === 'not oauth') await store.update(entry.id, { auth: { kind: 'none' } });
  if (failure === 'deleted') await store.remove(entry.id);
  expect(await store.completeAuthorization(entry.id, id)).toBe(false);
  expect(store.get(entry.id)?.lastAuthorizationId).toBeUndefined();
});

it('conditionally saves OAuth revisions and rejects stale refreshes and invalidations', async () => {
  const store = freshStore();
  const entry = await store.create({ slug: 'cas', displayName: 'CAS', url: 'https://mcp.example', auth: { kind: 'oauth' } });
  const first = (await store.compareAndSetOAuthState(entry.id, undefined, { tokens: { access_token: 'old' }, sessionId: 'old' }))!;
  expect(first.revision).toEqual(expect.any(String));
  await store.setOAuthState(entry.id, { tokens: { access_token: 'new' }, sessionId: 'new' });
  const fresh = (await store.getOAuthState(entry.id))!;
  expect(await store.compareAndSetOAuthState(entry.id, first.revision as string, { tokens: { access_token: 'stale-refresh' } })).toBeNull();
  expect(await store.compareAndSetOAuthState(entry.id, first.revision as string, {})).toBeNull();
  expect(await store.getOAuthState(entry.id)).toEqual(fresh);
  expect(store.get(entry.id)?.credentialRevision).toBeUndefined();
  const invalidated = await store.compareAndSetOAuthState(entry.id, fresh.revision as string, { sessionId: 'new' });
  expect(invalidated).not.toBeNull();
  expect(store.get(entry.id)?.credentialRevision).toEqual(expect.any(String));
  expect(await store.getOAuthState(entry.id)).not.toHaveProperty('tokens');
});

it('does not restore OAuth state after a server changes auth kind or is removed', async () => {
  const store = freshStore();
  const entry = await store.create({ slug: 'removed-cas', displayName: 'CAS', url: 'https://mcp.example', auth: { kind: 'oauth' } });
  await store.update(entry.id, { auth: { kind: 'none' } });
  expect(await store.compareAndSetOAuthState(entry.id, undefined, { tokens: { access_token: 'late' } })).toBeNull();
  await store.remove(entry.id);
  expect(await store.compareAndSetOAuthState(entry.id, undefined, { tokens: { access_token: 'late' } })).toBeNull();
});

it('allows only one writer to win across independent stores sharing the file lock', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-cas-lock-'));
  dirs.push(dir);
  const makeStore = () => mcpServerStore({ dir, secretBox: fakeSecretBox,
    lock: fileLock({ dir: path.join(dir, 'locks'), retryMs: 1 }) });
  const firstStore = makeStore();
  const secondStore = makeStore();
  const entry = await firstStore.create({ slug: 'locked', displayName: 'Locked', url: 'https://mcp.example', auth: { kind: 'oauth' } });
  const original = (await firstStore.compareAndSetOAuthState(entry.id, undefined, { tokens: { access_token: 'original' } }))!;
  const outcomes = await Promise.all([
    firstStore.compareAndSetOAuthState(entry.id, original.revision as string, { tokens: { access_token: 'first' } }),
    secondStore.compareAndSetOAuthState(entry.id, original.revision as string, { tokens: { access_token: 'second' } }),
  ]);
  expect(outcomes.filter(Boolean)).toHaveLength(1);
  expect(await firstStore.getOAuthState(entry.id)).toEqual(outcomes.find(Boolean));
});
