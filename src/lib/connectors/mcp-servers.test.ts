import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mcpServerStore, toSlug, type McpServerStore } from './mcp-servers';
import { validateMcpUrl, validateHeaderName } from './mcp-validate';

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
