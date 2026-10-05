import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ run: vi.fn(), current: vi.fn(), connections: vi.fn(), read: vi.fn(), view: vi.fn(), approvals: vi.fn(), servers: vi.fn() }));
vi.mock('@/lib/connectors/runtime', () => ({
  getConnectorOwnerId: () => 'owner', getConnectorRuntime: async () => ({ runAction: mocks.run, listConnections: mocks.connections }),
  getMcpServerStore: () => ({ list: mocks.servers }), getMcpViewConnection: mocks.view,
}));
vi.mock('@/lib/connectors/mcp-lifecycle', () => ({ isCurrentMcpTransport: mocks.current }));
vi.mock('@/lib/connectors/hosted-mcp', () => ({ hostedMcpConnectionId: (value: { connectionId: string }) => value.connectionId }));
vi.mock('@/lib/connectors/approval', () => ({ listPendingApprovals: mocks.approvals }));
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
