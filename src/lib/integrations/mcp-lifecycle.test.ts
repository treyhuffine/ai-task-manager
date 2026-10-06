import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createIntegrationRuntime, createRegistry, fileLock, staticAuthConfigs, type Lock } from '@integrations/engine';
import { fileStore } from '@integrations/engine/store';
import { plaintextSecretBox } from '@integrations/engine/testing';
import { ingestMcpServer } from '@integrations/engine/mcp';
import { mcpServerStore, type McpServerEntry } from './mcp-servers';
import { activateMcpServer, finalizeMcpServer, isCurrentMcpTransport, removeMcpServer, updateMcpServerConfiguration } from './mcp-lifecycle';

const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-lifecycle-'));
  dirs.push(dir);
  const lockDir = path.join(dir, 'locks');
  const connectionLock = fileLock({ dir: lockDir, retryMs: 1 });
  const secretBox = plaintextSecretBox();
  const connections = fileStore({ dir, lock: connectionLock });
  const servers = mcpServerStore({ dir, secretBox, lock: connectionLock });
  const entry = await servers.create({
    slug: 'builtin_todoist', providerId: 'todoist', connectionId: 'hosted-todoist', accountId: 'todoist:default',
    displayName: 'Todoist', url: 'https://ai.todoist.net/mcp', auth: { kind: 'oauth' },
  });
  const registry = createRegistry();
  const callTool = vi.fn(async () => ({ content: [] }));
  const save = async (current: McpServerEntry) => ingestMcpServer(registry, connections, secretBox, {
    name: current.slug, connectionId: current.connectionId,
    sessionToken: await servers.openSecret(current.id) ?? 'mcp-session',
    isCurrentTransport: () => isCurrentMcpTransport(current, servers),
    identity: { providerId: 'todoist', displayName: 'Todoist', accountId: current.accountId },
    client: {
      async listTools() { return { tools: [{ name: 'find-tasks' }] }; },
      callTool,
    },
  });
  // Separate instances exercise the filesystem mutex, not a shared JS mutex.
  const buildLock = fileLock({ dir: lockDir, retryMs: 1 });
  const deleteLock = fileLock({ dir: lockDir, retryMs: 1 });
  return { servers, connections, entry, registry, secretBox, callTool, save, buildLock, deleteLock };
}

describe('MCP server lifecycle', () => {
  it.each([
    { enabled: false }, { url: 'https://changed.example/mcp' }, { auth: { kind: 'none' as const } },
    { toolOverrides: { 'find-tasks': { enabled: false } } }, { secret: 'replacement-token' },
  ])('rejects stale cached transports even if another process leaves a derived row active: %o', async (patch) => {
    const s = await setup();
    await finalizeMcpServer(s.entry, s.servers, s.save, s.buildLock);
    const runtime = createIntegrationRuntime({
      registry: s.registry, store: s.connections, authRequests: s.connections, secretBox: s.secretBox,
      authConfigs: staticAuthConfigs([]), authorizationRequired: () => 'https://app.example/connect',
      approval: { check: async () => 'allow' },
    });
    await s.servers.update(s.entry.id, patch);
    expect((await s.connections.get(s.entry.connectionId!))?.connection.status).toBe('active');
    expect(await runtime.runAction('todoist.find-tasks', {})).toMatchObject({ ok: false, reason: 'auth_required' });
    expect(s.callTool).not.toHaveBeenCalled();
    expect(await finalizeMcpServer(s.entry, s.servers, s.save, s.buildLock)).toBeNull();
  });

  it('does not invalidate a transport just because discovery health or its display name changed', async () => {
    const s = await setup();
    await s.servers.setHealth(s.entry.id, { lastStatus: 'ok', lastCheckedAt: 'now' });
    await s.servers.update(s.entry.id, { displayName: 'My Todoist' });
    expect(isCurrentMcpTransport(s.entry, s.servers)).toBe(true);
  });
  it('waits for asynchronous finalization before rotating the token and rejects older discovery afterward', async () => {
    const s = await setup();
    const original = (await s.servers.update(s.entry.id, { auth: { kind: 'bearer' }, secret: 'original-fixture' }))!;
    const checked = deferred();
    const finishSave = deferred();
    const rotationRequested = deferred();
    const update = vi.spyOn(s.servers, 'update');
    const build = finalizeMcpServer(original, s.servers, async (current) => {
      checked.resolve();
      await finishSave.promise;
      expect(await s.servers.openSecret(current.id)).toBe('original-fixture');
      return s.save(current);
    }, s.buildLock);
    await checked.promise;
    const rotationLock: Lock = { withLock(key, operation) { rotationRequested.resolve(); return s.deleteLock.withLock(key, operation); } };
    const rotation = activateMcpServer(original, s.servers, s.connections, 'local', 'replacement-fixture', rotationLock);
    await rotationRequested.promise;
    expect(update).not.toHaveBeenCalled();
    finishSave.resolve();
    const [, rotated] = await Promise.all([build, rotation]);
    expect(rotated?.credentialRevision).not.toBe(original.credentialRevision);
    expect(await s.servers.openSecret(original.id)).toBe('replacement-fixture');
    expect((await s.connections.get(original.connectionId!))?.connection.status).toBe('needs_reauth');
    expect(await finalizeMcpServer(original, s.servers, s.save, s.buildLock)).toBeNull();
  });

  it('does not recreate an entry or token when rotation follows disconnect', async () => {
    const s = await setup();
    const original = (await s.servers.update(s.entry.id, { auth: { kind: 'bearer' }, secret: 'fixture' }))!;
    await removeMcpServer(original, s.servers, s.connections, 'local', s.deleteLock);
    expect(await activateMcpServer(original, s.servers, s.connections, 'local', 'replacement', s.buildLock)).toBeNull();
    expect(await s.servers.openSecret(original.id)).toBeNull();
    expect(s.servers.list()).toHaveLength(0);
  });

  it('blocks a cached runtime after token rotation even when replacement discovery fails', async () => {
    const s = await setup();
    const original = (await s.servers.update(s.entry.id, { auth: { kind: 'bearer' }, secret: 'old-fixture-token' }))!;
    await finalizeMcpServer(original, s.servers, s.save, s.buildLock);
    const cachedRuntime = createIntegrationRuntime({
      registry: s.registry, store: s.connections, authRequests: s.connections, secretBox: s.secretBox,
      authConfigs: staticAuthConfigs([]),
      authorizationRequired: () => 'https://app.example/connect?provider=todoist',
      approval: { check: async () => 'allow' },
    });
    expect(await cachedRuntime.runAction('todoist.find-tasks', {})).toMatchObject({ ok: true });
    s.callTool.mockClear();
    const rotated = (await activateMcpServer(original, s.servers, s.connections, 'local', 'new-fixture-token', s.deleteLock))!;
    await s.servers.setHealth(rotated.id, { lastStatus: 'unreachable', lastError: 'Replacement token discovery failed', lastCheckedAt: 'then' });
    expect(await cachedRuntime.runAction('todoist.find-tasks', {})).toMatchObject({ ok: false, reason: 'auth_required' });
    expect(s.callTool).not.toHaveBeenCalled();
    expect((await s.connections.get(original.connectionId!))?.connection.status).toBe('needs_reauth');
  });

  it.each([
    { enabled: false }, { url: 'https://changed.example/mcp' }, { auth: { kind: 'none' as const } },
  ])('invalidates a cached transport before a configuration change: %o', async (patch) => {
    const s = await setup();
    await finalizeMcpServer(s.entry, s.servers, s.save, s.buildLock);
    const runtime = createIntegrationRuntime({
      registry: s.registry, store: s.connections, authRequests: s.connections, secretBox: s.secretBox,
      authConfigs: staticAuthConfigs([]), authorizationRequired: () => 'https://app.example/connect',
      approval: { check: async () => 'allow' },
    });
    await updateMcpServerConfiguration(s.entry, s.servers, s.connections, 'local', patch, s.deleteLock);
    expect(await runtime.runAction('todoist.find-tasks', {})).toMatchObject({ ok: false, reason: 'auth_required' });
    expect(s.callTool).not.toHaveBeenCalled();
  });
  it('does not resurrect a connection when discovery finishes after disconnect', async () => {
    const s = await setup();
    await s.connections.save({
      id: 'hosted-todoist', ownerId: 'local', providerId: 'todoist', accountId: 'todoist:default',
      status: 'active', scopes: [], createdAt: 'then', updatedAt: 'then',
    }, 'sealed-original-credential');
    const discovery = deferred();
    const build = (async () => {
      const snapshot = s.servers.get(s.entry.id)!;
      await discovery.promise;
      return finalizeMcpServer(snapshot, s.servers, s.save, s.buildLock);
    })();

    await removeMcpServer(s.entry, s.servers, s.connections, 'local', s.deleteLock);
    discovery.resolve();
    expect(await build).toBeNull();
    expect(s.servers.get(s.entry.id)).toBeNull();
    expect(await s.connections.get('hosted-todoist')).toBeNull();
    expect(s.registry.getToolkit('todoist')).toBeUndefined();
  });

  it('serializes disconnect after finalization already passed the authoritative recheck', async () => {
    const s = await setup();
    const checked = deferred();
    const finishSave = deferred();
    const removalRequested = deferred();
    const remove = vi.spyOn(s.servers, 'remove');
    const independentDeleteLock: Lock = {
      withLock(key, operation) {
        removalRequested.resolve();
        return s.deleteLock.withLock(key, operation);
      },
    };
    const build = finalizeMcpServer(s.entry, s.servers, async (current) => {
      checked.resolve();
      await finishSave.promise;
      return s.save(current);
    }, s.buildLock);
    await checked.promise;
    const disconnect = removeMcpServer(s.entry, s.servers, s.connections, 'local', independentDeleteLock);
    await removalRequested.promise;
    expect(remove).not.toHaveBeenCalled();
    finishSave.resolve();
    await Promise.all([build, disconnect]);
    expect(remove).toHaveBeenCalledOnce();
    expect(s.servers.get(s.entry.id)).toBeNull();
    expect(await s.connections.get('hosted-todoist')).toBeNull();
  });

  it('leaves a replacement connection intact when an old disconnect or discovery completes later', async () => {
    const s = await setup();
    await removeMcpServer(s.entry, s.servers, s.connections, 'local', s.deleteLock);
    const replacement = await s.servers.create({
      slug: s.entry.slug, providerId: 'todoist', connectionId: 'hosted-todoist', accountId: 'todoist:default',
      displayName: 'Todoist', url: s.entry.url, auth: { kind: 'oauth' },
    });
    await finalizeMcpServer(replacement, s.servers, s.save, s.buildLock);
    expect(await finalizeMcpServer(s.entry, s.servers, s.save, s.buildLock)).toBeNull();
    await removeMcpServer(s.entry, s.servers, s.connections, 'local', s.deleteLock);
    expect(s.servers.get(replacement.id)).toBeTruthy();
    expect(await s.connections.get('hosted-todoist')).toBeTruthy();
  });

  it.each([{ enabled: false }, { url: 'https://changed.example/mcp' }])('rejects a stale discovery after a configuration change: %o', async (patch) => {
    const s = await setup();
    await s.servers.update(s.entry.id, patch);
    expect(await finalizeMcpServer(s.entry, s.servers, s.save, s.buildLock)).toBeNull();
    expect(await s.connections.get('hosted-todoist')).toBeNull();
  });

  it('refuses to remove another owner’s connection or authority', async () => {
    const s = await setup();
    await finalizeMcpServer(s.entry, s.servers, s.save, s.buildLock);
    expect(await removeMcpServer(s.entry, s.servers, s.connections, 'another-owner', s.deleteLock)).toBe(false);
    expect(s.servers.get(s.entry.id)).toBeTruthy();
    expect(await s.connections.get('hosted-todoist')).toBeTruthy();
  });
});
