import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConnectMcpOptions, McpToolDef } from '@connectors/engine/mcp';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { ensureHostedMcpServer, hostedMcpConnectionId } from './hosted-mcp';
import { removeMcpServer } from './mcp-lifecycle';
import { getConnectorConnectionStore, getConnectorRuntime, getMcpServerStore, invalidateConnectorRuntime, MCP_DISCOVERY_MAX_AGE_MS } from './runtime';
import type { McpServerEntry } from './mcp-servers';

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));
vi.mock('@connectors/engine/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@connectors/engine/mcp')>(), connectMcpClient: mocks.connect,
}));

const readTool: McpToolDef = { name: 'read', description: 'Read records', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { readOnlyHint: true } };
let dir: string;
const remotes = new Map<string, ReturnType<typeof remote>>();
function remote() {
  const state = { tools: [structuredClone(readTool)], notifications: [] as NonNullable<ConnectMcpOptions['onToolsChanged']>[],
    calls: vi.fn(async ({ name, arguments: args }: { name: string; arguments?: Record<string, unknown> }) => ({ content: [], structuredContent: { name, args } })),
    closes: vi.fn(async () => {}), list: vi.fn<() => Promise<{ tools: McpToolDef[] }>>() };
  state.list.mockImplementation(async () => ({ tools: structuredClone(state.tools) }));
  return state;
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-multiaccount-'));
  vi.stubEnv(APP_ROOT_ENV, dir);
  vi.stubEnv('NODE_ENV', 'test');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  invalidateConnectorRuntime();
  remotes.clear();
  mocks.connect.mockReset();
  mocks.connect.mockImplementation(async (options: ConnectMcpOptions) => {
    // The real SDK transport loads tokens before its first HTTP request.
    if (options.authProvider) await (options.authProvider as OAuthClientProvider).tokens();
    const state = remotes.get(options.name!);
    if (!state) throw new Error(`No fixture for ${options.name}`);
    if (options.onToolsChanged) state.notifications.push(options.onToolsChanged);
    return { listTools: state.list, callTool: state.calls, close: state.closes };
  });
});
afterEach(() => {
  invalidateConnectorRuntime();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function account(label: string, options: { add?: boolean; pending?: boolean } = {}) {
  const servers = getMcpServerStore();
  const entry = await ensureHostedMcpServer(getHostedMcpProvider('todoist')!, servers, getConnectorConnectionStore(), 'local', {
    ...(options.add ? { addAccount: true } : {}), label,
  });
  if (!options.pending) await servers.setOAuthState(entry.id, { tokens: { access_token: `fixture-${label}-token`, refresh_token: `fixture-${label}-refresh`, token_type: 'Bearer' } });
  const state = remote();
  remotes.set(entry.slug, state);
  return { entry, state, connectionId: hostedMcpConnectionId(entry) };
}

async function revoke(entry: McpServerEntry) {
  const servers = getMcpServerStore();
  const saved = (await servers.getOAuthState(entry.id))!;
  const next = { ...saved };
  delete next.tokens;
  await servers.compareAndSetOAuthState(entry.id, saved.revision as string, next);
}

describe('hosted multi-account runtime discovery', () => {
  it('publishes one Todoist toolkit and dispatches each account through its own connected client', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    const runtime = await getConnectorRuntime();
    expect(runtime.getToolkits().filter(toolkit => toolkit.id === 'todoist')).toHaveLength(1);
    expect(await runtime.runAction('todoist.read', {})).toMatchObject({ reason: 'needs_account', choices: [
      expect.objectContaining({ label: 'Personal' }), expect.objectContaining({ label: 'Work' }),
    ] });
    expect(await runtime.runAction('todoist.read', { id: 'work-record' }, { account: 'Work' })).toMatchObject({ ok: true });
    expect(await runtime.runAction('todoist.read', { id: 'personal-record' }, { allowedConnectionIds: [personal.connectionId] })).toMatchObject({ ok: true });
    expect(personal.state.calls).toHaveBeenCalledWith({ name: 'read', arguments: { id: 'personal-record' } });
    expect(work.state.calls).toHaveBeenCalledWith({ name: 'read', arguments: { id: 'work-record' } });
  });

  it('keeps a healthy account active when another setup is pending or another grant expires', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    await getConnectorRuntime();
    const pending = await account('Pending', { add: true, pending: true });
    await revoke(work.entry);
    const runtime = await getConnectorRuntime();
    expect((await getConnectorConnectionStore().get(personal.connectionId))?.connection.status).toBe('active');
    expect((await getConnectorConnectionStore().get(work.connectionId))?.connection.status).toBe('needs_reauth');
    expect(await getConnectorConnectionStore().get(pending.connectionId)).toBeNull();
    expect(await runtime.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ ok: true });
    expect(personal.state.calls).toHaveBeenCalledOnce();
    expect(work.state.calls).not.toHaveBeenCalled();
    expect(pending.state.list).not.toHaveBeenCalled();
  });

  it('refreshes notification changes and rejects the old capability projection without requesting OAuth', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    const old = await getConnectorRuntime();
    personal.state.tools = [
      { ...readTool, inputSchema: { type: 'object', properties: { record: { type: 'number' } }, required: ['record'] }, annotations: { readOnlyHint: false, destructiveHint: true } },
      { name: 'new_tool', annotations: { readOnlyHint: true } },
    ];
    await personal.state.notifications[0]!();
    expect(await old.runAction('todoist.read', { id: 'old' }, { connectionId: personal.connectionId })).toMatchObject({ code: 'tools_changed' });
    const fresh = await getConnectorRuntime();
    expect(fresh).not.toBe(old);
    expect(fresh.getToolkits().find(toolkit => toolkit.id === 'todoist')?.actions.map(action => action.id)).toContain('todoist.new_tool');
    expect(getMcpServerStore().get(personal.entry.id)?.capabilityChanges).toMatchObject({ added: ['new_tool'], changed: [{ name: 'read', fields: ['inputSchema', 'annotations'] }] });
    expect(await fresh.runAction('todoist.read', { record: 7 }, { connectionId: personal.connectionId })).toMatchObject({ ok: true });
    expect(await fresh.runAction('todoist.read', { id: 'work' }, { connectionId: work.connectionId })).toMatchObject({ ok: true });
    expect((await getConnectorConnectionStore().get(personal.connectionId))?.connection.status).toBe('active');
  });

  it('rechecks discovery after five minutes and rejects superseded clients even when tools stayed unchanged', async () => {
    const personal = await account('Personal');
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = await getConnectorRuntime();
    expect(await getConnectorRuntime()).toBe(old);
    expect(personal.state.list).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + MCP_DISCOVERY_MAX_AGE_MS + 1);
    const fresh = await getConnectorRuntime();
    expect(fresh).not.toBe(old);
    expect(personal.state.list).toHaveBeenCalledTimes(2);
    expect(await old.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ code: 'tools_changed' });
    expect(personal.state.calls).not.toHaveBeenCalled();
    expect(await fresh.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ ok: true });
  });

  it('observes capability revisions written by another store instance before dispatch or runtime reuse', async () => {
    const personal = await account('Personal');
    const old = await getConnectorRuntime();
    personal.state.tools = [{ ...readTool, description: 'Changed remotely' }];
    const anotherProcessStore = getMcpServerStore();
    await anotherProcessStore.recordCapabilities(personal.entry.id, personal.state.tools);
    expect(await old.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ code: 'tools_changed' });
    expect(personal.state.calls).not.toHaveBeenCalled();
    const fresh = await getConnectorRuntime();
    expect(fresh).not.toBe(old);
    expect(await fresh.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ ok: true });
  });

  it('disconnects one account without deleting or revoking its sibling', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    await getConnectorRuntime();
    const servers = getMcpServerStore();
    const workState = await servers.getOAuthState(work.entry.id);
    await removeMcpServer(personal.entry, servers, getConnectorConnectionStore(), 'local');
    const runtime = await getConnectorRuntime();
    expect(await getConnectorConnectionStore().get(personal.connectionId)).toBeNull();
    expect(await servers.getOAuthState(work.entry.id)).toEqual(workState);
    expect((await getConnectorConnectionStore().get(work.connectionId))?.connection.status).toBe('active');
    expect(await runtime.runAction('todoist.read', {}, { connectionId: work.connectionId })).toMatchObject({ ok: true });
    expect(await runtime.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ code: 'connection_not_found' });
  });

  it('does not bless configuration added by another process while initial discovery is in flight', async () => {
    const personal = await account('Personal');
    let work: Awaited<ReturnType<typeof account>> | undefined;
    personal.state.list.mockImplementationOnce(async () => {
      work = await account('Work', { add: true });
      return { tools: structuredClone(personal.state.tools) };
    });
    const runtime = await getConnectorRuntime();
    expect(work).toBeDefined();
    expect(await runtime.runAction('todoist.read', {}, { connectionId: work!.connectionId })).toMatchObject({ ok: true });
    expect(work!.state.list).toHaveBeenCalledOnce();
    expect(personal.state.list).toHaveBeenCalledTimes(2);
  });

  it('discards a discovery interrupted by a tool-list notification instead of publishing stale permissions', async () => {
    const personal = await account('Personal');
    personal.state.list.mockImplementationOnce(async () => {
      const previous = structuredClone(personal.state.tools);
      personal.state.tools = [{ name: 'replacement', annotations: { readOnlyHint: true } }];
      await personal.state.notifications[0]!();
      return { tools: previous };
    });
    const runtime = await getConnectorRuntime();
    const actions = runtime.getToolkits().find(toolkit => toolkit.id === 'todoist')!.actions.map(action => action.id);
    expect(actions).toEqual(['todoist.replacement']);
    expect(personal.state.list).toHaveBeenCalledTimes(2);
    expect(await runtime.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ code: 'unknown_action' });
  });

  it('bounds a continuously changing account without preventing its healthy sibling from loading', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    personal.state.list.mockImplementation(async () => {
      await personal.state.notifications[0]!();
      return { tools: structuredClone(personal.state.tools) };
    });
    const runtime = await getConnectorRuntime();
    expect(personal.state.list).toHaveBeenCalledTimes(3);
    expect(getMcpServerStore().get(personal.entry.id)).toMatchObject({ lastStatus: 'unreachable', lastError: expect.stringContaining('kept changing') });
    expect(personal.state.closes).toHaveBeenCalledOnce();
    expect(work.state.list).toHaveBeenCalledOnce();
    expect(await runtime.runAction('todoist.read', {}, { connectionId: work.connectionId })).toMatchObject({ ok: true });
  });

  it('redacts sibling credentials learned later in discovery before persisting or projecting the union', async () => {
    const personal = await account('Personal');
    await account('Work', { add: true });
    personal.state.tools = [{ ...readTool,
      description: 'Reflected fixture-Work-token',
      inputSchema: { type: 'object', properties: { reflected: { type: 'string', description: 'fixture-Work-refresh' } } },
      outputSchema: { type: 'object', properties: { reflected: { const: 'fixture-Work-token' } } },
    }];
    const runtime = await getConnectorRuntime();
    const persisted = fs.readFileSync(path.join(dir, '.config', 'connectors', 'mcp-servers.json'), 'utf8');
    const projected = runtime.getToolkits().find(toolkit => toolkit.id === 'todoist')!;
    for (const secret of ['fixture-Work-token', 'fixture-Work-refresh']) {
      expect(persisted).not.toContain(secret);
      expect(JSON.stringify(projected)).not.toContain(secret);
    }
  });
});
