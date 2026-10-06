import { beginAccountChat, serveAccountChat, accountChatStatus, accountChatCapture } from './account-chat';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), current: vi.fn(), connections: vi.fn(), read: vi.fn(), view: vi.fn(), approvals: vi.fn(), servers: vi.fn(), toolkits: vi.fn() }));
vi.mock('@/lib/integrations/runtime', async () => { return ({
  getIntegrationOwnerId: () => 'owner', getIntegrationRuntime: async () => ({ getToolkits: () => mocks.toolkits(), runAction: mocks.run, listConnections: mocks.connections }),
  getMcpServerStore: () => ({ list: mocks.servers }), getMcpViewConnection: mocks.view,
}); });
vi.mock('@/lib/integrations/mcp-lifecycle', () => ({ isCurrentMcpTransport: mocks.current }));
vi.mock('@/lib/integrations/hosted-mcp', () => ({ hostedMcpConnectionId: (value: { connectionId: string }) => value.connectionId }));
vi.mock('@/lib/integrations/approval', () => ({ listPendingApprovals: mocks.approvals }));
vi.mock('./evaluation', () => ({ launchPluginEvaluation: async () => ({ url: 'https://examples.test/s/sample/index.html', expiresAt: new Date(Date.now() + 60000).toISOString() }) }));
import { accountEvaluationCatalog, accountEvaluationRpc, endAccountEvaluation, launchAccountEvaluation } from './account-evaluation';

const tools = [
  { name: 'query', inputSchema: { type: 'object' }, _meta: { ui: { resourceUri: 'ui://query', visibility: ['model'] } } },
  { name: 'filter', inputSchema: { type: 'object' }, _meta: { ui: { visibility: ['app'] } } },
  { name: 'blocked', _meta: { ui: { resourceUri: 'ui://blocked' } } },
];
const snapshot = { id: 'server', providerId: 'posthog', connectionId: 'selected-account', displayName: 'Analytics', enabled: true, lastStatus: 'ok', toolOverrides: { blocked: { enabled: false } } };
beforeEach(() => {
  vi.clearAllMocks();
  (globalThis as typeof globalThis & { __riAccountEvaluations?: Map<string, unknown> }).__riAccountEvaluations?.clear();
  mocks.toolkits.mockReturnValue([{ actions: [{ id: 'posthog.query', input: z.object({ prompt: z.string() }) }] }]);
  mocks.current.mockReturnValue(true); mocks.connections.mockResolvedValue([{ id: 'selected-account', status: 'active' }]);
  mocks.view.mockResolvedValue({ snapshot, tools, readResource: mocks.read }); mocks.servers.mockReturnValue([snapshot]); mocks.approvals.mockReturnValue([]);
  mocks.run.mockImplementation(async (_action, _args, options) => {
    options.captureOriginalResult({ content: [{ type: 'text', text: 'Query finished' }], structuredContent: { rows: [42] }, _meta: { privateUi: 'view only' } });
    return { ok: true, result: { content: 'model summary' } };
  });
});
const launch = () => launchAccountEvaluation('https://ri.test', 'server', 'viewer');
function call(handle: string, overrides = {}) { return { handle, method: 'tools/call' as const, name: 'query', arguments: {}, invocationId: randomUUID(), audience: 'model' as const, ...overrides }; }

it('discovers account UI capabilities without running a tool and excludes disabled definitions', async () => {
  expect(await accountEvaluationCatalog()).toEqual([{ providerId: 'posthog', serverId: 'server', label: 'Analytics', available: true, interactiveTools: 1, status: 'Interactive views discovered' }]);
  const { handle } = await launch();
  const listed = await accountEvaluationRpc({ handle, method: 'tools/list', audience: 'app' }, 'viewer');
  expect((listed.result as { tools: unknown[] }).tools).toHaveLength(2);
  expect(mocks.run).not.toHaveBeenCalled();
});
it('captures private UI data once for concurrent delivery and pins the originating connection', async () => {
  const { handle } = await launch(); const input = call(handle);
  const [a, b] = await Promise.all([accountEvaluationRpc(input, 'viewer'), accountEvaluationRpc(input, 'viewer')]);
  expect(a).toEqual(b); expect(a.result).toHaveProperty('_meta.privateUi', 'view only');
  expect(mocks.run).toHaveBeenCalledTimes(1);
  expect(mocks.run.mock.calls[0]).toMatchObject(['posthog.query', {}, { ownerId: 'owner', connectionId: 'selected-account', caller: { type: 'app' }, toolAudience: 'model' }]);
  await expect(accountEvaluationRpc({ ...input, arguments: { changed: true } }, 'viewer')).rejects.toMatchObject({ status: 409 });
  await accountEvaluationRpc(call(handle), 'viewer'); expect(mocks.run).toHaveBeenCalledTimes(2);
});
it('blocks another viewer, revoked authority, disabled tools and wrong audience before upstream execution', async () => {
  const { handle } = await launch();
  await expect(accountEvaluationRpc(call(handle), 'other-viewer')).rejects.toMatchObject({ status: 410 });
  await expect(accountEvaluationRpc(call(handle, { name: 'filter' }), 'viewer')).rejects.toMatchObject({ status: 403 });
  await expect(accountEvaluationRpc(call(handle, { name: 'blocked' }), 'viewer')).rejects.toMatchObject({ status: 403 });
  mocks.current.mockReturnValue(false);
  await expect(accountEvaluationRpc(call(handle), 'viewer')).rejects.toMatchObject({ status: 403 });
  expect(mocks.run).not.toHaveBeenCalled();
  mocks.current.mockReturnValue(true); mocks.connections.mockResolvedValue([]);
  await expect(accountEvaluationRpc(call(handle), 'viewer')).rejects.toMatchObject({ status: 403 });
});
it('retries only an explicit approval gate, preserving the same invocation', async () => {
  const { handle } = await launch(); const input = call(handle);
  mocks.run.mockResolvedValueOnce({ ok: false, reason: 'approval_required', actionId: 'posthog.query', preview: { args: {} } });
  mocks.approvals.mockReturnValue([{ id: 'approval', sessionId: null, actionId: 'posthog.query', connectionId: 'selected-account', preview: { args: {} } }]);
  const paused = await accountEvaluationRpc(input, 'viewer'); expect(paused.approvalIds).toEqual(['approval']);
  await accountEvaluationRpc(input, 'viewer'); expect(mocks.run).toHaveBeenCalledTimes(1);
  await accountEvaluationRpc({ ...input, retryApproval: true }, 'viewer');
  await accountEvaluationRpc({ ...input, retryApproval: true }, 'viewer'); expect(mocks.run).toHaveBeenCalledTimes(2);
});
it('never repeats unknown outcomes, uncaptured results or ended sessions', async () => {
  const { handle } = await launch(); const input = call(handle);
  mocks.run.mockRejectedValueOnce(new Error('Connection ended after accepting work'));
  await expect(accountEvaluationRpc(input, 'viewer')).rejects.toThrow('Connection ended');
  await expect(accountEvaluationRpc({ ...input, retryApproval: true }, 'viewer')).rejects.toThrow('Connection ended');
  expect(mocks.run).toHaveBeenCalledTimes(1);
  mocks.run.mockResolvedValueOnce({ ok: true }); const uncaptured = call(handle);
  await expect(accountEvaluationRpc(uncaptured, 'viewer')).rejects.toMatchObject({ status: 409 });
  await expect(accountEvaluationRpc(uncaptured, 'viewer')).rejects.toMatchObject({ status: 409 });
  expect(mocks.run).toHaveBeenCalledTimes(2);
  endAccountEvaluation(handle, 'other-viewer'); await accountEvaluationRpc(call(handle), 'viewer');
  endAccountEvaluation(handle, 'viewer'); await expect(accountEvaluationRpc(call(handle), 'viewer')).rejects.toMatchObject({ status: 410 });
});
it('keeps accepted work independent of the frame while withholding a result after revocation', async () => {
  const { handle } = await launch();
  mocks.run.mockImplementationOnce(async (_action, _args, options) => {
    options.captureOriginalResult({ content: [{ type: 'text', text: 'Completed' }] });
    mocks.current.mockReturnValue(false);
    return { ok: true };
  });
  await expect(accountEvaluationRpc(call(handle), 'viewer')).rejects.toMatchObject({ status: 403 });
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it('reads only advertised isolated UI resources and rechecks revocation after a read', async () => {
  const { handle } = await launch(); const input = { handle, method: 'resources/read' as const, uri: 'ui://query', audience: 'app' as const };
  mocks.read.mockResolvedValue({ contents: [{ uri: 'ui://query', mimeType: 'text/html;profile=mcp-app', text: '<main>View</main>' }] });
  await expect(accountEvaluationRpc({ ...input, uri: 'file:///private' }, 'viewer')).rejects.toMatchObject({ status: 403 });
  expect(mocks.read).not.toHaveBeenCalled(); await accountEvaluationRpc(input, 'viewer');
  mocks.read.mockResolvedValue({ contents: [{ uri: 'ui://query', mimeType: 'text/html;profile=mcp-app', text: '<main>View</main>', _meta: { ui: { csp: { connectDomains: ['https://ri.test'] } } } }] });
  await expect(accountEvaluationRpc(input, 'viewer')).rejects.toMatchObject({ status: 403 });
  mocks.read.mockImplementation(async () => { mocks.current.mockReturnValue(false); return { contents: [{ uri: 'ui://query', mimeType: 'text/html;profile=mcp-app', text: '<main>View</main>' }] }; });
  await expect(accountEvaluationRpc(input, 'viewer')).rejects.toMatchObject({ status: 403 });
});

it('account chats use only the originating model-visible UI tool, with private metadata captured outside prompts', async () => {
  const { handle } = await launch(); const source = call(handle); await accountEvaluationRpc(source, 'viewer');
  const { ticket } = await beginAccountChat(handle, 'viewer', source.invocationId, randomUUID(), 'query');
  const registerTool = vi.fn(); await serveAccountChat({ registerTool }, ticket);
  expect(registerTool).toHaveBeenCalledTimes(1); expect(registerTool.mock.calls[0][0]).toBe('query');
  const handler = registerTool.mock.calls[0][2];
  const result = await handler({ prompt: 'Show another query' });
  expect(JSON.stringify(result)).not.toContain('privateUi'); expect(JSON.stringify(result)).not.toContain('view only');
  expect(await accountChatStatus(ticket)).toMatchObject({ status: 'ready', view: { invocationId: source.invocationId } });
  await handler({ prompt: 'Repeat' }); expect(mocks.run).toHaveBeenCalledTimes(2);
  const captured = await accountChatCapture(ticket, 'viewer'); expect(captured.result).toHaveProperty('_meta.privateUi', 'view only');
  await expect(accountChatCapture(ticket, 'viewer')).rejects.toMatchObject({ status: 409 });
  await expect(beginAccountChat(handle, 'viewer', source.invocationId, randomUUID(), 'filter')).rejects.toMatchObject({ status: 403 });
  await expect(beginAccountChat(handle, 'other-viewer', source.invocationId, randomUUID(), 'query')).rejects.toMatchObject({ status: 410 });
});

it('account chat advertises only the selected connection schema, excluding other-account fields in the toolkit union', async () => {
  const selected = { ...tools[0], inputSchema: { type: 'object', properties: { prompt: { type: 'string' } }, required: ['prompt'] } };
  mocks.view.mockResolvedValue({ snapshot, tools: [selected], readResource: mocks.read });
  mocks.toolkits.mockReturnValue([{ actions: [{ id: 'posthog.query', input: z.object({ prompt: z.string(), otherAccountSecretField: z.string().optional() }) }] }]);
  const { handle } = await launch(); const source = call(handle); await accountEvaluationRpc(source, 'viewer');
  const { ticket } = await beginAccountChat(handle, 'viewer', source.invocationId, randomUUID(), 'query');
  const registerTool = vi.fn(); await serveAccountChat({ registerTool }, ticket);
  expect(Object.keys(registerTool.mock.calls[0][1].inputSchema)).toEqual(['prompt']);
  expect(registerTool.mock.calls[0][1].inputSchema.prompt.safeParse(undefined).success).toBe(false);
});
it('account chat approval retries only a gated invocation and rechecks access before publishing a capture', async () => {
  const { handle } = await launch(); const source = call(handle); await accountEvaluationRpc(source, 'viewer');
  const { ticket } = await beginAccountChat(handle, 'viewer', source.invocationId, randomUUID(), 'query');
  const registerTool = vi.fn(); await serveAccountChat({ registerTool }, ticket);
  mocks.run.mockResolvedValueOnce({ ok: false, reason: 'approval_required', actionId: 'posthog.query', preview: {} });
  mocks.approvals.mockReturnValue([{ id: 'approve-chat', sessionId: null, actionId: 'posthog.query', connectionId: 'selected-account', preview: {} }]);
  await registerTool.mock.calls[0][2]({ prompt: 'Requested query' });
  expect(await accountChatStatus(ticket)).toMatchObject({ status: 'approval', ticket, approvalIds: ['approve-chat'] });
  await expect(accountChatCapture(ticket, 'viewer')).rejects.toMatchObject({ status: 409 });
  expect(mocks.run).toHaveBeenCalledTimes(2);
  await accountChatCapture(ticket, 'viewer', true); expect(mocks.run).toHaveBeenCalledTimes(3);
  const another = await beginAccountChat(handle, 'viewer', source.invocationId, randomUUID(), 'query');
  mocks.current.mockReturnValue(false);
  await expect(serveAccountChat({ registerTool }, another.ticket)).rejects.toMatchObject({ status: 403 });
});

it.each(['asana', 'figma', 'posthog'])('binds %s chat calls to its actual discovered UI tool and selected account', async providerId => {
  mocks.view.mockResolvedValue({ snapshot: { ...snapshot, providerId }, tools, readResource: mocks.read });
  mocks.toolkits.mockReturnValue([{ actions: [{ id: `${providerId}.query`, input: z.object({ prompt: z.string() }) }] }]);
  const { handle } = await launch(); const source = call(handle); await accountEvaluationRpc(source, 'viewer');
  const { ticket } = await beginAccountChat(handle, 'viewer', source.invocationId, randomUUID(), 'query');
  const registerTool = vi.fn(); await serveAccountChat({ registerTool }, ticket);
  await registerTool.mock.calls[0][2]({ prompt: 'Revise the selected workflow' });
  expect(mocks.run.mock.calls[1]).toMatchObject([`${providerId}.query`, { prompt: 'Revise the selected workflow' }, { connectionId: 'selected-account', toolAudience: 'model' }]);
  expect(await accountChatStatus(ticket)).toMatchObject({ status: 'ready' });
});
