/**
 * AuthConfig Case B — the persisted BYO layer: the AuthConfigStore adapters, the store-backed
 * registry (bundled ∪ store), and the admin service (sealing + cross-store invariants).
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { storeAuthConfigRegistry, type AuthConfigInput } from '../auth-configs';
import { createAuthConfigAdmin } from '../core/auth-config-admin';
import { inMemoryAuthConfigStore, authConfigFileStore } from '../store/auth-config';
import { modelSafeOutcome } from '../core/projection-shared';
import { bearer } from '../auth/direct';
import { inMemoryStore, plaintextSecretBox } from '../testing';
import type { AuthConfig, Connection, Provider } from '../core/types';

const RU = 'http://127.0.0.1/cb';
function bundled(id: string, over: Partial<AuthConfigInput> = {}): AuthConfigInput {
  return {
    id,
    providerId: 'google',
    scheme: 'oauth2',
    scope: 'global',
    isDefault: true,
    oauth: { clientId: `C-${id}`, redirectUri: RU },
    clientSecret: `S-${id}`,
    status: 'active',
    ...over,
  };
}

describe('AuthConfigStore (in-memory)', () => {
  it('CRUD + setDefault flips at the same visibility level', async () => {
    const store = inMemoryAuthConfigStore();
    const a: AuthConfig = { id: 'a', providerId: 'p', scheme: 'oauth2', label: 'A', scope: 'global', oauth: { clientId: 'CA', redirectUri: RU }, status: 'active' };
    const b: AuthConfig = { ...a, id: 'b', label: 'B', oauth: { clientId: 'CB', redirectUri: RU } };
    await store.create(a, 'sealed-A');
    await store.create(b);
    expect((await store.listForProvider('p')).map((c) => c.id)).toEqual(['a', 'b']);
    expect((await store.get('a'))?.sealedSecret).toBe('sealed-A');

    await store.setDefault('p', 'b');
    const after = await store.listForProvider('p');
    expect(after.find((c) => c.id === 'b')?.isDefault).toBe(true);
    expect(after.find((c) => c.id === 'a')?.isDefault).toBe(false);

    await store.setStatus('a', 'archived');
    expect((await store.get('a'))?.config.status).toBe('archived');
    await store.delete('b');
    expect((await store.listForProvider('p')).map((c) => c.id)).toEqual(['a']);
  });
});

describe('authConfigFileStore (disk round-trip — the real write path)', () => {
  it('persists a sealed config to auth-configs.json and reads it back', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authcfg-'));
    try {
      const store = authConfigFileStore({ dir });
      const config: AuthConfig = { id: 'g-1', providerId: 'google', scheme: 'oauth2', label: 'Work', scope: 'owner', ownerId: 'U1', oauth: { clientId: 'C', redirectUri: RU }, status: 'active' };
      await store.create(config, 'SEALED-BLOB');

      // it's actually on disk
      const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'auth-configs.json'), 'utf8'));
      expect(onDisk).toHaveLength(1);
      expect(onDisk[0].config.id).toBe('g-1');
      expect(onDisk[0].sealedSecret).toBe('SEALED-BLOB');

      // and reads back through the store
      const got = await store.get('g-1');
      expect(got?.config.label).toBe('Work');
      expect(got?.sealedSecret).toBe('SEALED-BLOB');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it('admin over the file store writes a sealed (not plaintext) secret to disk', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'authcfg-'));
    try {
      const secretBox = plaintextSecretBox();
      const admin = createAuthConfigAdmin({ store: authConfigFileStore({ dir }), connections: inMemoryStore(), secretBox });
      const summary = await admin.addConfig({ providerId: 'google', scheme: 'oauth2', label: 'Work', ownerId: 'U1', oauth: { clientId: 'C', redirectUri: RU }, clientSecret: 'PLAINTEXT' });

      const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'auth-configs.json'), 'utf8'));
      const entry = onDisk.find((e: { config: { id: string } }) => e.config.id === summary.id);
      expect(JSON.stringify(entry.config)).not.toContain('PLAINTEXT'); // metadata is secret-free
      expect(await secretBox.open(entry.sealedSecret)).toBe('PLAINTEXT'); // secret is sealed, round-trips
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('storeAuthConfigRegistry (bundled ∪ store)', () => {
  it('merges sources, visibility-filters, and opens each secret from its own place', async () => {
    const secretBox = plaintextSecretBox();
    const store = inMemoryAuthConfigStore();
    // a BYO owner-scoped config with a SEALED secret
    const byoConfig: AuthConfig = { id: 'g-byo', providerId: 'google', scheme: 'oauth2', label: 'Personal', scope: 'owner', ownerId: 'U1', oauth: { clientId: 'C-byo', redirectUri: RU }, status: 'active' };
    await store.create(byoConfig, await secretBox.seal('BYO-SECRET'));

    const reg = storeAuthConfigRegistry({ bundled: [bundled('g-bundled', { label: 'Default' })], store, secretBox });

    // U1 sees both (global + their own owner config); U2 sees only the global bundled one.
    expect((await reg.listForConnect('google', { ownerId: 'U1' })).map((c) => c.id).sort()).toEqual(['g-bundled', 'g-byo']);
    expect((await reg.listForConnect('google', { ownerId: 'U2' })).map((c) => c.id)).toEqual(['g-bundled']);

    // secret-free reads
    expect(JSON.stringify(await reg.listForConnect('google', { ownerId: 'U1' }))).not.toContain('SECRET');
    expect(JSON.stringify(await reg.listForProvider('google', { ownerId: 'U1' }))).not.toContain('SECRET');

    // open from the in-process bundled map vs the sealed store
    expect((await reg.openConfigForConnection('google', 'g-bundled'))?.clientSecret).toBe('S-g-bundled');
    expect((await reg.openConfigForConnection('google', 'g-byo'))?.clientSecret).toBe('BYO-SECRET');
  });
});

describe('AuthConfigAdmin', () => {
  function setup() {
    const secretBox = plaintextSecretBox();
    const store = inMemoryAuthConfigStore();
    const connections = inMemoryStore();
    const admin = createAuthConfigAdmin({ store, connections, secretBox });
    return { admin, store, connections, secretBox };
  }

  it('seals the client secret before the store sees it; metadata stays secret-free', async () => {
    const s = setup();
    const summary = await s.admin.addConfig({
      providerId: 'google',
      scheme: 'oauth2',
      label: 'Work',
      ownerId: 'U1',
      oauth: { clientId: 'C-work', redirectUri: RU },
      clientSecret: 'PLAINTEXT-SECRET',
    });
    const stored = await s.store.get(summary.id);
    expect(stored).toBeTruthy();
    expect(JSON.stringify(stored!.config)).not.toContain('PLAINTEXT-SECRET'); // metadata has no secret
    expect(await s.secretBox.open(stored!.sealedSecret!)).toBe('PLAINTEXT-SECRET'); // sealed round-trips
  });

  it('refuses to delete a config while connections reference it', async () => {
    const s = setup();
    const summary = await s.admin.addConfig({ providerId: 'google', scheme: 'oauth2', label: 'Work', ownerId: 'U1', oauth: { clientId: 'C', redirectUri: RU } });
    const conn: Connection = { id: 'c1', ownerId: 'U1', providerId: 'google', accountId: 'a', scopes: [], status: 'active', authConfigId: summary.id, createdAt: 'now', updatedAt: 'now' };
    await s.connections.save(conn, 'sealed');
    await expect(s.admin.removeConfig(summary.id)).rejects.toMatchObject({ code: 'conflict' });
    // disconnect, then delete succeeds
    await s.connections.delete('c1');
    await s.admin.removeConfig(summary.id);
    expect(await s.store.get(summary.id)).toBeNull();
  });

  it('refuses to repoint the default while legacy (unstamped) connections exist', async () => {
    const s = setup();
    await s.admin.addConfig({ id: 'g-1', providerId: 'google', scheme: 'oauth2', label: 'One', ownerId: 'U1', oauth: { clientId: 'C', redirectUri: RU } });
    const legacy: Connection = { id: 'c1', ownerId: 'U1', providerId: 'google', accountId: 'a', scopes: [], status: 'active', createdAt: 'now', updatedAt: 'now' }; // no authConfigId
    await s.connections.save(legacy, 'sealed');
    await expect(s.admin.setDefault('google', 'g-1')).rejects.toMatchObject({ code: 'conflict' });
  });

  it('validates required fields', async () => {
    const s = setup();
    await expect(s.admin.addConfig({ providerId: 'google', scheme: 'oauth2', label: '', ownerId: 'U1', oauth: { clientId: 'C', redirectUri: RU } })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(s.admin.addConfig({ providerId: 'google', scheme: 'oauth2', label: 'X', oauth: { clientId: 'C', redirectUri: RU } })).rejects.toMatchObject({ code: 'invalid_input' }); // no ownerId
    await expect(s.admin.addConfig({ providerId: 'google', scheme: 'oauth2', label: 'X', ownerId: 'U1' })).rejects.toMatchObject({ code: 'invalid_input' }); // oauth2 needs oauth
  });

  it('setDefault on an unknown id fails loudly instead of silently no-op-ing', async () => {
    const s = setup();
    await expect(s.admin.setDefault('google', 'nope')).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects a provider-incompatible config BEFORE persisting (getProvider)', async () => {
    const store = inMemoryAuthConfigStore();
    const provider = { id: 'svc', displayName: 'Svc', auth: bearer() } as Provider; // kind 'bearer'
    const admin = createAuthConfigAdmin({
      store,
      connections: inMemoryStore(),
      secretBox: plaintextSecretBox(),
      getProvider: (id) => (id === 'svc' ? provider : undefined),
    });
    await expect(
      admin.addConfig({ providerId: 'svc', scheme: 'oauth2', label: 'X', ownerId: 'U1', oauth: { clientId: 'C', redirectUri: RU } }),
    ).rejects.toMatchObject({ code: 'invalid_input' }); // scheme oauth2 ≠ provider strategy bearer
    expect(await store.listForProvider('svc')).toEqual([]); // nothing written
  });
});

describe('needs_account projection (§7 tiebreaker)', () => {
  it('renders the authConfigLabel so same-email-via-two-clients is distinguishable', () => {
    const safe = modelSafeOutcome({
      ok: false,
      reason: 'needs_account',
      providerId: 'google',
      choices: [
        { connectionId: 'a', email: 'me@gmail.com', authConfigLabel: 'Work' },
        { connectionId: 'b', email: 'me@gmail.com', authConfigLabel: 'Personal' },
      ],
    });
    expect((safe as { accounts: string[] }).accounts).toEqual(['me@gmail.com (Work)', 'me@gmail.com (Personal)']);
    expect(JSON.stringify(safe)).not.toContain('connectionId'); // still no opaque id
  });
});
