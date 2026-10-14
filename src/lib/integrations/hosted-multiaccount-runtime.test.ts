import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { serveMcp, type McpToolRegistrar } from '@integrations/engine/mcp';
import type { ConnectMcpOptions, ConnectedMcpClient, McpToolDef } from '@integrations/engine/mcp';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';
import { IntegrationError } from '@integrations/engine';
import { StreamableHTTPError } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import { ensureHostedMcpServer, hostedMcpConnectionId } from './hosted-mcp';
import { removeMcpServer } from './mcp-lifecycle';
import { getIntegrationConnectionStore, getIntegrationRuntime, getMcpServerStore, invalidateIntegrationRuntime, MCP_DISCOVERY_MAX_AGE_MS, MCP_DISCOVERY_RETRY_MS } from './runtime';
import type { McpServerEntry } from './mcp-servers';
import { _resetApprovals } from './approval';
import { GET as getWritePolicy, POST as setWritePolicy } from '@/lib/server/operations/integrations/write-policy';
import { unwrapOperation, type OperationContext } from '@/lib/server/operation';

const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));
vi.mock('@integrations/engine/mcp', async importOriginal => ({
  ...await importOriginal<typeof import('@integrations/engine/mcp')>(), connectMcpClient: mocks.connect,
}));

const readTool: McpToolDef = { name: 'read', description: 'Read records', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { readOnlyHint: true } };
let dir: string;
const remotes = new Map<string, ReturnType<typeof remote>>();
function remote() {
  const state = { tools: [structuredClone(readTool)], notifications: [] as NonNullable<ConnectMcpOptions['onToolsChanged']>[],
    calls: vi.fn<ConnectedMcpClient['callTool']>(async ({ name, arguments: args }) => ({ content: [], structuredContent: { name, args } })),
    closes: vi.fn(async () => {}), list: vi.fn<() => Promise<{ tools: McpToolDef[] }>>() };
  state.list.mockImplementation(async () => ({ tools: structuredClone(state.tools) }));
  return state;
}

beforeEach(() => {
  _resetApprovals();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-multiaccount-'));
  vi.stubEnv(APP_ROOT_ENV, dir);
  vi.stubEnv('NODE_ENV', 'test');
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  invalidateIntegrationRuntime();
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
  _resetApprovals();
  invalidateIntegrationRuntime();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('custom MCP permission enforcement', () => {
  it('preserves built-in MCP legacy choices and lets provider settings restore their native defaults', async () => {
    vi.stubEnv('INTEGRATIONS_AUTO_APPROVE', '0');
    const fixture = await account('Legacy');
    fixture.state.tools.push({ name: 'write', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: true } });
    const servers = getMcpServerStore();
    await servers.update(fixture.entry.id, { toolOverrides: { write: { mutating: false }, read: { mutating: true } } });
    await servers.setDefaultApprovalPolicy('ask', true);
    const runtime = await getIntegrationRuntime();
    expect(await runtime.runAction('todoist.write', {}, { connectionId: fixture.connectionId })).toMatchObject({ ok: true });
    expect(await runtime.runAction('todoist.read', {}, { connectionId: fixture.connectionId })).toMatchObject({ reason: 'approval_required' });
    const context: OperationContext = { headers: new Headers(), url: 'http://localhost/api/integrations/write-policy', nextUrl: new URL('http://localhost/api/integrations/write-policy'), signal: new AbortController().signal };
    const before = unwrapOperation(await getWritePolicy({}, context));
    expect(before.toolkits.find(toolkit => toolkit.id === 'todoist')?.actions.find(action => action.id === 'todoist.write')).toMatchObject({ mode: 'auto', defaultMode: 'ask', overridden: true });
    unwrapOperation(await setWritePolicy({ body: { actionId: 'todoist.write', mode: null } }, context));
    expect(await runtime.runAction('todoist.write', {}, { connectionId: fixture.connectionId })).toMatchObject({ reason: 'approval_required' });
    expect(servers.get(fixture.entry.id)?.toolOverrides).toEqual({ read: { mutating: true } });
    expect(await getIntegrationRuntime()).toBe(runtime);
  });
  async function customServer() {
    vi.stubEnv('INTEGRATIONS_AUTO_APPROVE', '0');
    const entry = await getMcpServerStore().create({ slug: 'custom_permissions', displayName: 'Custom permissions', url: 'https://example.com/mcp', auth: { kind: 'none' } });
    const state = remote();
    state.tools = [readTool, { name: 'write', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false } }, { name: 'unmarked', inputSchema: { type: 'object' } }];
    remotes.set(entry.slug, state);
    return { entry, state };
  }

  it('uses read-only annotations and gates every write, including unmarked tools', async () => {
    const { entry, state } = await customServer();
    const runtime = await getIntegrationRuntime();
    expect(await runtime.runAction(`mcp.${entry.slug}.read`, {})).toMatchObject({ ok: true });
    expect(await runtime.runAction(`mcp.${entry.slug}.write`, {})).toMatchObject({ reason: 'approval_required' });
    expect(await runtime.runAction(`mcp.${entry.slug}.unmarked`, {})).toMatchObject({ reason: 'approval_required' });
    expect(state.calls).toHaveBeenCalledOnce();
    expect(getMcpServerStore().get(entry.id)?.tools).toEqual(expect.arrayContaining([{ name: 'read', description: 'Read records', readOnlyHint: true }, { name: 'write', readOnlyHint: false }]));
  });

  it('enforces server and tool permissions on a cached runtime without reconnecting', async () => {
    const { entry, state } = await customServer();
    const store = getMcpServerStore();
    const runtime = await getIntegrationRuntime();
    await store.update(entry.id, { approvalPolicy: 'auto', resetToolApprovals: true });
    expect(await runtime.runAction(`mcp.${entry.slug}.write`, {})).toMatchObject({ ok: true });
    expect(runtime.getToolkits().find(toolkit => toolkit.id === `mcp_${entry.slug}`)?.actions.find(action => action.id.endsWith('.write'))?.mutating).toBe(true);
    await store.update(entry.id, { approvalPolicy: 'ask' });
    expect(await runtime.runAction(`mcp.${entry.slug}.read`, {})).toMatchObject({ reason: 'approval_required' });
    await store.update(entry.id, { toolOverrides: { read: { approvalMode: 'auto' } } });
    expect(await runtime.runAction(`mcp.${entry.slug}.read`, {})).toMatchObject({ ok: true });
    await store.update(entry.id, { toolOverrides: { read: { approvalMode: null } } });
    expect(await runtime.runAction(`mcp.${entry.slug}.read`, {})).toMatchObject({ reason: 'approval_required' });
    await store.update(entry.id, { approvalPolicy: null });
    expect(await runtime.runAction(`mcp.${entry.slug}.read`, {})).toMatchObject({ ok: true });
    expect(await runtime.runAction(`mcp.${entry.slug}.write`, {})).toMatchObject({ reason: 'approval_required' });
    expect(await getIntegrationRuntime()).toBe(runtime);
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(state.closes).not.toHaveBeenCalled();
  });

  it('preserves legacy approval choices without losing write failure semantics', async () => {
    const { entry, state } = await customServer();
    await getMcpServerStore().update(entry.id, { toolOverrides: { write: { mutating: false }, read: { mutating: true } } });
    const runtime = await getIntegrationRuntime();
    expect(await runtime.runAction(`mcp.${entry.slug}.read`, {})).toMatchObject({ reason: 'approval_required' });
    expect(await runtime.runAction(`mcp.${entry.slug}.write`, {})).toMatchObject({ ok: true });
    state.calls.mockRejectedValueOnce(new IntegrationError('provider_timeout', 'The fixture request timed out'));
    expect(await runtime.runAction(`mcp.${entry.slug}.write`, {})).toMatchObject({ ok: false, code: 'provider_timeout', indeterminate: true });
  });

  it('applies the global preference to existing and newly discovered tools while keeping disabled tools hidden', async () => {
    const { entry, state } = await customServer();
    const store = getMcpServerStore();
    await store.update(entry.id, { approvalPolicy: 'ask', toolOverrides: { read: { approvalMode: 'ask' }, unmarked: { enabled: false } } });
    const runtime = await getIntegrationRuntime();
    await store.setDefaultApprovalPolicy('auto', true);
    expect(await runtime.runAction(`mcp.${entry.slug}.read`, {})).toMatchObject({ ok: true });
    expect(await runtime.runAction(`mcp.${entry.slug}.write`, {})).toMatchObject({ ok: true });
    expect(runtime.getToolkits().find(toolkit => toolkit.id === `mcp_${entry.slug}`)?.actions.some(action => action.id.endsWith('.unmarked'))).toBe(false);
    state.tools.push({ name: 'new_write', inputSchema: { type: 'object' } });
    invalidateIntegrationRuntime();
    const fresh = await getIntegrationRuntime();
    expect(await fresh.runAction(`mcp.${entry.slug}.new_write`, {})).toMatchObject({ ok: true });
    await store.setDefaultApprovalPolicy('ask');
    expect(await fresh.runAction(`mcp.${entry.slug}.read`, {})).toMatchObject({ reason: 'approval_required' });
  });
});

async function account(label: string, options: { add?: boolean; pending?: boolean } = {}) {
  const servers = getMcpServerStore();
  const entry = await ensureHostedMcpServer(getHostedMcpProvider('todoist')!, servers, getIntegrationConnectionStore(), 'local', {
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

async function staticAccount() {
  const entry = await ensureHostedMcpServer(getHostedMcpProvider('dataforseo')!, getMcpServerStore(),
    getIntegrationConnectionStore(), 'local', { label: 'Research', secret: 'fixture@example.com:fixture-password' });
  const state = remote();
  state.tools = [{ name: 'api_request', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, destructiveHint: false } }];
  remotes.set(entry.slug, state);
  vi.stubEnv('INTEGRATIONS_AUTO_APPROVE', '1');
  return { entry, state, connectionId: hostedMcpConnectionId(entry) };
}

describe('hosted multi-account runtime discovery', () => {
  it('dispatches all fourteen calls concurrently and admits more across runtime refreshes', async () => {
    const research = await staticAccount();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = await getIntegrationRuntime();
    const finish: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    research.state.calls.mockImplementation(() => new Promise(resolve => {
      peak = Math.max(peak, ++active);
      finish.push(() => { active--; resolve({ content: [] }); });
    }));
    const calls = Array.from({ length: 14 }, () => old.runAction('dataforseo.api_request', {}));
    await vi.waitFor(() => expect(finish).toHaveLength(14));
    clock.mockReturnValue(now + MCP_DISCOVERY_MAX_AGE_MS + 1);
    const fresh = await getIntegrationRuntime();
    expect(fresh).not.toBe(old);
    calls.push(fresh.runAction('dataforseo.api_request', {}));
    expect(research.state.closes).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(finish).toHaveLength(15));
    expect(peak).toBe(15);
    finish.forEach(resolve => resolve());
    expect((await Promise.all(calls)).every(result => result.ok)).toBe(true);
    await vi.waitFor(() => expect(research.state.closes).toHaveBeenCalledOnce());
  });

  it('keeps discovery and credentials active after one paid request times out, without replaying it', async () => {
    const research = await staticAccount();
    const runtime = await getIntegrationRuntime();
    const saved = await getIntegrationConnectionStore().get(research.connectionId);
    research.state.calls.mockRejectedValueOnce(new IntegrationError('provider_timeout', 'fixture-password request timed out'));
    const results = await Promise.all(Array.from({ length: 6 }, () => runtime.runAction('dataforseo.api_request', {})));
    expect(results.filter(result => !result.ok)).toEqual([expect.objectContaining({ code: 'provider_timeout', indeterminate: true })]);
    expect(results.filter(result => result.ok)).toHaveLength(5);
    expect(research.state.calls).toHaveBeenCalledTimes(6);
    expect(research.state.closes).not.toHaveBeenCalled();
    expect(await getIntegrationRuntime()).toBe(runtime);
    expect(await getIntegrationConnectionStore().get(research.connectionId)).toEqual(saved);
    const metadata = getMcpServerStore().get(research.entry.id)!;
    expect(metadata).toMatchObject({ lastStatus: 'ok', lastRequestError: { code: 'provider_timeout' } });
    expect(metadata.lastRequestError?.message).not.toContain('fixture-password');
    expect(metadata.lastFailure).toBeUndefined();
    expect(metadata.healthHistory?.at(-1)?.lastRequestError).toEqual(metadata.lastRequestError);
  });

  it.each(['protocol', 'http'] as const)('cancels paid calls before dispatch through the %s signal without invalidating discovery', async source => {
    const research = await staticAccount();
    const runtime = await getIntegrationRuntime();
    const finish: (() => void)[] = [];
    research.state.calls.mockImplementation(() => new Promise(resolve => { finish.push(() => resolve({ content: [] })); }));
    const calls = Array.from({ length: 3 }, () => runtime.runAction('dataforseo.api_request', {}));
    await vi.waitFor(() => expect(finish).toHaveLength(3));
    let handler!: Parameters<McpToolRegistrar['registerTool']>[2];
    const controller = new AbortController();
    serveMcp({ registerTool(name, _config, run) { if (name === 'dataforseo__api_request') handler = run; } }, runtime, source === 'http' ? { signal: controller.signal } : {});
    const cancelled = handler({}, source === 'protocol' ? { signal: controller.signal } : undefined);
    // The signal travels through the engine even when cancellation races dispatch.
    controller.abort();
    const result = await cancelled;
    expect(JSON.parse(result.content[0]!.text)).toMatchObject({ code: 'denied' });
    expect(await getIntegrationRuntime()).toBe(runtime);
    expect(research.state.closes).not.toHaveBeenCalled();
    finish.forEach(resolve => resolve());
    await Promise.all(calls);
    expect(research.state.calls).toHaveBeenCalledTimes(3);
  });

  it('stops new sends when an established transport closes while allowing concurrent sent requests to finish', async () => {
    const research = await staticAccount();
    const runtime = await getIntegrationRuntime();
    const finish: (() => void)[] = [];
    let fail!: () => void;
    research.state.calls.mockImplementation(() => new Promise((resolve, reject) => {
      if (!fail) fail = () => reject(new Error('Connection closed'));
      finish.push(() => resolve({ content: [] }));
    }));
    const calls = Array.from({ length: 6 }, () => runtime.runAction('dataforseo.api_request', {}));
    await vi.waitFor(() => expect(finish).toHaveLength(6));
    fail();
    await vi.waitFor(() => expect(getMcpServerStore().get(research.entry.id)?.lastStatus).toBe('unreachable'));
    expect(await runtime.runAction('dataforseo.api_request', {})).toMatchObject({ code: 'tools_changed' });
    finish.forEach(resolve => resolve());
    const results = await Promise.all(calls);
    expect(results.filter(result => result.ok)).toHaveLength(5);
    expect(results.filter(result => !result.ok && result.reason === 'error' && result.code === 'provider_unavailable')).toEqual([expect.objectContaining({ indeterminate: true })]);
    expect(research.state.calls).toHaveBeenCalledTimes(6);
    await vi.waitFor(() => expect(research.state.closes).toHaveBeenCalledOnce());
  });

  it('rejects new requests when tool access changes while allowing sent requests to finish', async () => {
    const research = await staticAccount();
    const runtime = await getIntegrationRuntime();
    const finish: (() => void)[] = [];
    research.state.calls.mockImplementation(() => new Promise(resolve => { finish.push(() => resolve({ content: [] })); }));
    const calls = Array.from({ length: 4 }, () => runtime.runAction('dataforseo.api_request', {}));
    await vi.waitFor(() => expect(finish).toHaveLength(4));
    await getMcpServerStore().update(research.entry.id, { toolOverrides: { api_request: { enabled: false } } });
    expect(await runtime.runAction('dataforseo.api_request', {})).toMatchObject({ reason: 'auth_required' });
    finish.forEach(resolve => resolve());
    const results = await Promise.all(calls);
    expect(results.every(result => result.ok)).toBe(true);
    expect(research.state.calls).toHaveBeenCalledTimes(4);
  });

  it('rejects new requests when the account loses authorization while allowing sent requests to finish', async () => {
    const research = await staticAccount();
    const runtime = await getIntegrationRuntime();
    const finish: (() => void)[] = [];
    research.state.calls.mockImplementation(() => new Promise(resolve => { finish.push(() => resolve({ content: [] })); }));
    const calls = Array.from({ length: 4 }, () => runtime.runAction('dataforseo.api_request', {}));
    await vi.waitFor(() => expect(finish).toHaveLength(4));
    await getIntegrationConnectionStore().setStatus(research.connectionId, 'needs_reauth');
    expect(await runtime.runAction('dataforseo.api_request', {})).toMatchObject({ reason: 'auth_required' });
    finish.forEach(resolve => resolve());
    const results = await Promise.all(calls);
    expect(results.every(result => result.ok)).toBe(true);
    expect(research.state.calls).toHaveBeenCalledTimes(4);
  });

  it('lets an already-started paid request finish across the five-minute refresh', async () => {
    const research = await staticAccount();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = await getIntegrationRuntime();
    let finish!: () => void;
    research.state.calls.mockImplementationOnce(() => new Promise(resolve => {
      finish = () => resolve({ content: [], structuredContent: { name: 'api_request', args: {} } });
    }));
    const pending = old.runAction('dataforseo.api_request', {});
    await vi.waitFor(() => expect(research.state.calls).toHaveBeenCalledOnce());
    clock.mockReturnValue(now + MCP_DISCOVERY_MAX_AGE_MS + 1);
    const fresh = await getIntegrationRuntime();
    expect(fresh).not.toBe(old);
    expect(research.state.closes).not.toHaveBeenCalled();
    expect(await old.runAction('dataforseo.api_request', {})).toMatchObject({ code: 'tools_changed' });
    finish();
    expect(await pending).toMatchObject({ ok: true });
    await vi.waitFor(() => expect(research.state.closes).toHaveBeenCalledOnce());
    expect(research.state.calls).toHaveBeenCalledOnce();
  });

  it('keeps known tools through a discovery outage and recovers after the short cooldown without changing credentials', async () => {
    const research = await staticAccount();
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    await getIntegrationRuntime();
    const stored = await getIntegrationConnectionStore().get(research.connectionId);
    const credentialRevision = getMcpServerStore().get(research.entry.id)?.credentialRevision;
    clock.mockReturnValue(now + MCP_DISCOVERY_MAX_AGE_MS + 1);
    mocks.connect.mockRejectedValueOnce(new Error('fetch failed'));
    const unavailable = await getIntegrationRuntime();
    expect(unavailable.getToolkits().some(toolkit => toolkit.id === 'dataforseo')).toBe(true);
    expect(await unavailable.runAction('dataforseo.api_request', {})).toMatchObject({
      ok: false, code: 'provider_unavailable', message: expect.stringContaining('No request was sent'),
    });
    expect(research.state.calls).not.toHaveBeenCalled();
    expect(await getIntegrationConnectionStore().get(research.connectionId)).toEqual(stored);
    expect(getMcpServerStore().get(research.entry.id)).toMatchObject({ lastStatus: 'unreachable', credentialRevision,
      lastFailure: { kind: 'unavailable', phase: 'connect' } });
    expect(await getIntegrationRuntime()).toBe(unavailable);
    clock.mockReturnValue(now + MCP_DISCOVERY_MAX_AGE_MS + MCP_DISCOVERY_RETRY_MS + 2);
    const recovered = await getIntegrationRuntime();
    expect(recovered).not.toBe(unavailable);
    expect(await recovered.runAction('dataforseo.api_request', {})).toMatchObject({ ok: true });
    expect(research.state.calls).toHaveBeenCalledOnce();
    expect(getMcpServerStore().get(research.entry.id)).toMatchObject({ lastStatus: 'ok', healthHistory: [
      expect.objectContaining({ lastStatus: 'ok' }), expect.objectContaining({ lastStatus: 'unreachable' }),
      expect.objectContaining({ lastStatus: 'ok' }),
    ] });
    expect(getMcpServerStore().get(research.entry.id)?.lastFailure).toBeUndefined();
  });

  it('retires a failed transport without replaying an indeterminate paid call, then reconnects on the next use', async () => {
    const research = await staticAccount();
    const old = await getIntegrationRuntime();
    research.state.calls.mockRejectedValueOnce(new Error('MCP error -32000: Connection closed'));
    expect(await old.runAction('dataforseo.api_request', {})).toMatchObject({
      ok: false, code: 'provider_unavailable', indeterminate: true,
    });
    expect(research.state.calls).toHaveBeenCalledOnce();
    expect((await getIntegrationConnectionStore().get(research.connectionId))?.connection.status).toBe('active');
    expect(getMcpServerStore().get(research.entry.id)?.lastFailure).toEqual({ kind: 'unavailable', phase: 'call' });
    const fresh = await getIntegrationRuntime();
    expect(fresh).not.toBe(old);
    expect(research.state.calls).toHaveBeenCalledOnce();
    expect(await fresh.runAction('dataforseo.api_request', {})).toMatchObject({ ok: true });
    expect(research.state.calls).toHaveBeenCalledTimes(2);
  });

  it('leaves the connection in place when the provider returns an ordinary API request error', async () => {
    const research = await staticAccount();
    const runtime = await getIntegrationRuntime();
    research.state.calls.mockResolvedValueOnce({ content: [{ type: 'text', text: 'Invalid API path' }], isError: true });
    expect(await runtime.runAction('dataforseo.api_request', {})).toMatchObject({ code: 'provider_error' });
    expect(await getIntegrationRuntime()).toBe(runtime);
    expect(research.state.closes).not.toHaveBeenCalled();
    expect((await getIntegrationConnectionStore().get(research.connectionId))?.connection.status).toBe('active');
    expect(getMcpServerStore().get(research.entry.id)?.lastFailure).toBeUndefined();
    expect(await runtime.runAction('dataforseo.api_request', {})).toMatchObject({ ok: true });
  });

  it('does not persist reflected credential values in failure history', async () => {
    const research = await staticAccount();
    const token = (await getMcpServerStore().openSecret(research.entry.id))!;
    const runtime = await getIntegrationRuntime();
    research.state.calls.mockRejectedValueOnce(new Error(`Transport failed: ${token}`));
    const outcome = await runtime.runAction('dataforseo.api_request', {});
    expect(JSON.stringify(outcome)).not.toContain(token);
    const metadata = getMcpServerStore().get(research.entry.id)!;
    expect(JSON.stringify(metadata.lastError)).not.toContain(token);
    expect(JSON.stringify(metadata.healthHistory)).not.toContain(token);
    expect(metadata.lastFailure).toEqual({ kind: 'unavailable', phase: 'call' });
  });

  it('keeps a rejected API credential inactive even though tool discovery does not validate it', async () => {
    const research = await staticAccount();
    const old = await getIntegrationRuntime();
    research.state.calls.mockRejectedValueOnce(new StreamableHTTPError(401, 'Unauthorized'));
    // The real client converts call rejection to NeedsReauthError. This fixture
    // deliberately leaves the typed HTTP rejection intact to cover host handling.
    expect(await old.runAction('dataforseo.api_request', {})).toMatchObject({ reason: 'auth_required' });
    const rejected = await getIntegrationConnectionStore().get(research.connectionId);
    expect(rejected?.connection.status).toBe('needs_reauth');
    const pending = await getIntegrationRuntime();
    expect(pending.getToolkits().some(toolkit => toolkit.id === 'dataforseo')).toBe(true);
    expect(await pending.runAction('dataforseo.api_request', {})).toMatchObject({ reason: 'auth_required' });
    expect(mocks.connect).toHaveBeenCalledOnce();
    expect(await getIntegrationConnectionStore().get(research.connectionId)).toEqual(rejected);
    const servers = getMcpServerStore();
    await servers.update(research.entry.id, { secret: Buffer.from('fixture@example.com:replacement').toString('base64') });
    const recovered = await getIntegrationRuntime();
    expect(await recovered.runAction('dataforseo.api_request', {})).toMatchObject({ ok: true });
    expect((await getIntegrationConnectionStore().get(research.connectionId))?.connection.status).toBe('active');
  });

  it('does not reuse a cached unavailable account after disconnect or disabled tool policy', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    await getIntegrationRuntime();
    invalidateIntegrationRuntime();
    mocks.connect.mockRejectedValueOnce(new Error('fetch failed'));
    const unavailable = await getIntegrationRuntime();
    expect(await unavailable.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ code: 'provider_unavailable' });
    expect(await unavailable.runAction('todoist.read', {}, { connectionId: work.connectionId })).toMatchObject({ ok: true });
    await getMcpServerStore().update(personal.entry.id, { toolOverrides: { read: { enabled: false } } });
    expect(await unavailable.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ reason: 'auth_required' });
    await removeMcpServer(personal.entry, getMcpServerStore(), getIntegrationConnectionStore(), 'local');
    expect(await unavailable.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ code: 'connection_not_found' });
    expect(personal.state.calls).not.toHaveBeenCalled();
  });

  it('publishes one Todoist toolkit and dispatches each account through its own connected client', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    const runtime = await getIntegrationRuntime();
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
    await getIntegrationRuntime();
    const pending = await account('Pending', { add: true, pending: true });
    await revoke(work.entry);
    const runtime = await getIntegrationRuntime();
    expect((await getIntegrationConnectionStore().get(personal.connectionId))?.connection.status).toBe('active');
    expect((await getIntegrationConnectionStore().get(work.connectionId))?.connection.status).toBe('needs_reauth');
    expect(await getIntegrationConnectionStore().get(pending.connectionId)).toBeNull();
    expect(await runtime.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ ok: true });
    expect(personal.state.calls).toHaveBeenCalledOnce();
    expect(work.state.calls).not.toHaveBeenCalled();
    expect(pending.state.list).not.toHaveBeenCalled();
  });

  it('refreshes notification changes and rejects the old capability projection without requesting OAuth', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    const old = await getIntegrationRuntime();
    personal.state.tools = [
      { ...readTool, inputSchema: { type: 'object', properties: { record: { type: 'number' } }, required: ['record'] }, annotations: { readOnlyHint: false, destructiveHint: true } },
      { name: 'new_tool', annotations: { readOnlyHint: true } },
    ];
    await personal.state.notifications[0]!();
    expect(await old.runAction('todoist.read', { id: 'old' }, { connectionId: personal.connectionId })).toMatchObject({ code: 'tools_changed' });
    const fresh = await getIntegrationRuntime();
    expect(fresh).not.toBe(old);
    expect(fresh.getToolkits().find(toolkit => toolkit.id === 'todoist')?.actions.map(action => action.id)).toContain('todoist.new_tool');
    expect(getMcpServerStore().get(personal.entry.id)?.capabilityChanges).toMatchObject({ added: ['new_tool'], changed: [{ name: 'read', fields: ['inputSchema', 'annotations'] }] });
    expect(await fresh.runAction('todoist.read', { record: 7 }, { connectionId: personal.connectionId })).toMatchObject({ ok: true });
    expect(await fresh.runAction('todoist.read', { id: 'work' }, { connectionId: work.connectionId })).toMatchObject({ ok: true });
    expect((await getIntegrationConnectionStore().get(personal.connectionId))?.connection.status).toBe('active');
  });

  it('rechecks discovery after five minutes and rejects superseded clients even when tools stayed unchanged', async () => {
    const personal = await account('Personal');
    const now = Date.now();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(now);
    const old = await getIntegrationRuntime();
    expect(await getIntegrationRuntime()).toBe(old);
    expect(personal.state.list).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(now + MCP_DISCOVERY_MAX_AGE_MS + 1);
    const fresh = await getIntegrationRuntime();
    expect(fresh).not.toBe(old);
    expect(personal.state.list).toHaveBeenCalledTimes(2);
    expect(await old.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ code: 'tools_changed' });
    expect(personal.state.calls).not.toHaveBeenCalled();
    expect(await fresh.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ ok: true });
  });

  it('observes capability revisions written by another store instance before dispatch or runtime reuse', async () => {
    const personal = await account('Personal');
    const old = await getIntegrationRuntime();
    personal.state.tools = [{ ...readTool, description: 'Changed remotely' }];
    const anotherProcessStore = getMcpServerStore();
    await anotherProcessStore.recordCapabilities(personal.entry.id, personal.state.tools);
    expect(await old.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ code: 'tools_changed' });
    expect(personal.state.calls).not.toHaveBeenCalled();
    const fresh = await getIntegrationRuntime();
    expect(fresh).not.toBe(old);
    expect(await fresh.runAction('todoist.read', {}, { connectionId: personal.connectionId })).toMatchObject({ ok: true });
  });

  it('disconnects one account without deleting or revoking its sibling', async () => {
    const personal = await account('Personal');
    const work = await account('Work', { add: true });
    await getIntegrationRuntime();
    const servers = getMcpServerStore();
    const workState = await servers.getOAuthState(work.entry.id);
    await removeMcpServer(personal.entry, servers, getIntegrationConnectionStore(), 'local');
    const runtime = await getIntegrationRuntime();
    expect(await getIntegrationConnectionStore().get(personal.connectionId)).toBeNull();
    expect(await servers.getOAuthState(work.entry.id)).toEqual(workState);
    expect((await getIntegrationConnectionStore().get(work.connectionId))?.connection.status).toBe('active');
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
    const runtime = await getIntegrationRuntime();
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
    const runtime = await getIntegrationRuntime();
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
    const runtime = await getIntegrationRuntime();
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
    const runtime = await getIntegrationRuntime();
    const persisted = fs.readFileSync(path.join(dir, '.config', 'integrations', 'mcp-servers.json'), 'utf8');
    const projected = runtime.getToolkits().find(toolkit => toolkit.id === 'todoist')!;
    for (const secret of ['fixture-Work-token', 'fixture-Work-refresh']) {
      expect(persisted).not.toContain(secret);
      expect(JSON.stringify(projected)).not.toContain(secret);
    }
  });
});
