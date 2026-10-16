import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const mocks = vi.hoisted(() => ({metadata: vi.fn(), runtime: vi.fn(), transport: vi.fn(), connections: vi.fn(), run: vi.fn(), read: vi.fn(), chat: vi.fn(), workspace: vi.fn(), insert: vi.fn(), approvals: vi.fn(), decide: vi.fn(), cancel: vi.fn()}));
vi.mock('@/lib/integrations/source-metadata', () => ({integrationSourceMetadata: mocks.metadata}));
vi.mock('@/lib/integrations/runtime', () => ({getIntegrationRuntime: mocks.runtime, getIntegrationOwnerId: () => 'local', getMcpViewConnection: mocks.transport}));
vi.mock('@/lib/db/queries', () => ({getChatSessionWithExecution: mocks.chat, getWorkspace: mocks.workspace, insertChatEvent: mocks.insert}));
vi.mock('@/lib/integrations/approval', () => ({sessionCaller: (id: string) => ({type: 'mcp', id: `session:${id}`}), sessionIdFromCaller: (caller?: {type?: string; id?: string}) => caller?.type === 'mcp' && caller.id?.startsWith('session:') ? caller.id.slice(8) : null, listPendingApprovals: mocks.approvals, resolvePendingApprovals: mocks.decide, cancelConnectedAppApprovals: mocks.cancel}));
vi.mock('@/lib/integrations/approval-events', () => ({recordApprovalDecision: vi.fn()}));
import { prepareMcpResultCapture, connectedAppsCatalog, openConnectedView, callConnectedView, cancelConnectedInvocation, launchConnectedView, prepareConnectedLaunch, mcpViews, updateConnectedContext, freezeConnectedContext, connectedTurnContext, decideConnectedApproval } from './service';

const chatId = randomUUID();
const result = {content: [{type: 'text', text: 'Public summary'}], structuredContent: {total: 42}, _meta: {privateUi: 'Only for the interface'}};
const tools = [
  {name: 'calculate', inputSchema: {type: 'object', properties: {amount: {type: 'number'}}, required: ['amount']}, _meta: {ui: {resourceUri: 'ui://fixture/calculator.html'}}},
  {name: 'filter', _meta: {ui: {visibility: ['app']}}},
  {name: 'model_only', _meta: {ui: {visibility: ['model']}}},
];
let entry: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks(); process.env.RI_LOCAL_APPS = '0'; delete process.env.RI_MCP_APPS;
  mcpViews().views.clear(); mcpViews().captures.clear();
  entry = {id: 'server', slug: 'fixture', enabled: true, displayName: 'Fixture', url: 'https://fixture.invalid/mcp', credentialRevision: 1, capabilityRevision: 'v1'};
  const connection = {id: 'mcp-fixture', providerId: 'mcp_fixture', ownerId: 'local', accountId: 'account-A', status: 'active', scopes: []};
  mocks.metadata.mockImplementation(async () => ({servers: [{entry, capabilities: {tools}}], connections: [connection], toolkits: [{id: 'mcp_fixture', providerId: 'mcp_fixture', displayName: 'Fixture'}]}));
  mocks.connections.mockResolvedValue([connection]);
  mocks.runtime.mockResolvedValue({listConnections: mocks.connections, runAction: mocks.run});
  mocks.transport.mockResolvedValue({tools, readResource: mocks.read});
  mocks.read.mockResolvedValue({contents: [{uri: 'ui://fixture/calculator.html', mimeType: 'text/html;profile=mcp-app', text: '<html><body>Calculator</body></html>'}]});
  mocks.chat.mockReturnValue({id: chatId, status: 'idle', workspaceId: null, origin: 'ri'});
  mocks.approvals.mockReturnValue([]);
  mocks.decide.mockReturnValue({resolved: [], missing: []});
  mocks.cancel.mockImplementation(() => {const pending = mocks.approvals(); mocks.approvals.mockReturnValue([]); return pending;});
  mocks.run.mockImplementation(async (_action, _args, options) => { options.captureOriginalResult(result); return {ok: true, result: {content: result.content, structuredContent: result.structuredContent}}; });
});
const prepareCapture = () => prepareMcpResultCapture({ownerId: 'local', connectionId: 'mcp-fixture', actionId: 'mcp.fixture.calculate', attemptId: randomUUID(), caller: {type: 'mcp', id: `session:${chatId}`}, audience: 'model', input: {amount: 2}});
async function capture() {
  const complete = await prepareCapture();
  await complete!(result);
  return [...mcpViews().captures.values()][0].id;
}
describe('connected MCP views', () => {
  it('cancels a late approval and never dispatches its retry, even if access was revoked', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId), invocationId = randomUUID();
    let respond!: () => void;
    mocks.run.mockImplementationOnce(async (_action, _args, options) => {
      await new Promise<void>(resolve => {respond = resolve;});
      mocks.approvals.mockReturnValue([{id: 'approval', connectedApp: options.caller.connectedApp}]);
      return {ok: false, reason: 'approval_required', preview: {}};
    });
    const run = callConnectedView(view.id, 'viewer', 'filter', {}, invocationId);
    const rejected = expect(run).rejects.toThrow('cancelled');
    await vi.waitFor(() => expect(mocks.run).toHaveBeenCalledTimes(1));
    await expect(cancelConnectedInvocation(view.id, 'other', invocationId)).rejects.toThrow('unavailable');
    entry.enabled = false;
    await cancelConnectedInvocation(view.id, 'viewer', invocationId);
    respond(); await rejected;
    expect(mocks.approvals()).toEqual([]);
    expect(mocks.cancel).toHaveBeenLastCalledWith({viewId: view.id, viewerId: 'viewer', invocationId, sourceRef: view.sourceRef}, chatId);
    entry.enabled = true;
    await expect(callConnectedView(view.id, 'viewer', 'filter', {}, invocationId)).rejects.toThrow('cancelled');
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it('honors a cancellation that arrives before the invoke request', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId), invocationId = randomUUID();
    await cancelConnectedInvocation(view.id, 'viewer', invocationId);
    await cancelConnectedInvocation(view.id, 'viewer', invocationId);
    await expect(callConnectedView(view.id, 'viewer', 'filter', {}, invocationId)).rejects.toThrow('cancelled');
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(['credentialRevision', 'capabilityRevision', 'url', 'toolOverrides'])('rejects a late originating result after %s changes', async field => {
    const complete = await prepareCapture();
    entry[field] = field === 'toolOverrides' ? {calculate: {enabled: false}} : 'changed';
    await expect(complete!(result)).rejects.toThrow('access changed');
    expect(mcpViews().captures.size).toBe(0); expect(mocks.insert).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('discovers from cached capabilities without executing or building a transport', async () => {
    expect(await connectedAppsCatalog()).toMatchObject([{id: 'server', available: true, tools: [{name: 'calculate', global: false}]}]);
    expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it('names a server by its toolkit, so every account of one product shares a name', async () => {
    const second = {...entry, id: 'second', slug: 'builtin_todoist', providerId: 'todoist', displayName: 'Todoist 2'};
    const connection = {id: 'hosted-todoist', providerId: 'todoist', ownerId: 'local', accountId: 'todoist:2', status: 'active', scopes: []};
    mocks.metadata.mockImplementation(async () => ({servers: [{entry, capabilities: {tools}}, {entry: second, capabilities: {tools}}], connections: [connection],
      toolkits: [{id: 'todoist', providerId: 'todoist', displayName: 'Todoist'}]}));
    expect((await connectedAppsCatalog()).map(app => [app.id, app.name, app.toolkitName])).toEqual([['server', 'Fixture', 'Fixture'], ['second', 'Todoist 2', 'Todoist']]);
  });
  it('captures the original result, keeps private metadata out of the transcript, and never replays on open', async () => {
    const id = await capture();
    expect(JSON.stringify(mocks.insert.mock.calls)).not.toContain('Only for the interface');
    expect(mocks.insert.mock.calls[0][0]).toMatchObject({id, sessionId: chatId, content: 'mcp_app_result'});
    const first = await openConnectedView(id, 'viewer', chatId);
    const second = await openConnectedView(id, 'viewer', chatId);
    expect(first.id).toBe(second.id); expect(first.result).toEqual(result);
    expect(mocks.run).not.toHaveBeenCalled(); expect(mocks.read).toHaveBeenCalledTimes(1);
    await expect(openConnectedView(id, 'viewer', randomUUID())).rejects.toThrow('different');
    expect((await openConnectedView(id, 'another-viewer', chatId)).id).not.toBe(first.id);
  });
  it('uses exact account, app audience and viewer identity for callbacks, coalescing delivery', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId), invocation = randomUUID();
    const [a,b] = await Promise.all([callConnectedView(view.id, 'viewer', 'filter', {value: 1}, invocation), callConnectedView(view.id, 'viewer', 'filter', {value: 1}, invocation)]);
    expect(a).toEqual(b); expect(a).toMatchObject({kind: 'result', result}); expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run.mock.calls[0]).toMatchObject(['mcp.fixture.filter', {value: 1}, {connectionId: 'mcp-fixture', allowedConnectionIds: ['mcp-fixture'], toolAudience: 'app', caller: {type: 'mcp', id: `session:${chatId}`, connectedApp: {viewId: view.id, invocationId: invocation, viewerId: 'viewer'}}}]);
    await expect(callConnectedView(view.id, 'viewer', 'filter', {value: 2}, invocation)).rejects.toThrow('different operation');
    await expect(callConnectedView(view.id, 'viewer', 'model_only', {}, randomUUID())).rejects.toThrow('not available');
    await expect(callConnectedView(view.id, 'other', 'filter', {}, randomUUID())).rejects.toThrow('unavailable');
  });
  it('preserves a useful text result when a UI resource is unsupported', async () => {
    mocks.read.mockResolvedValue({contents:[{uri:'ui://fixture/calculator.html',mimeType:'text/html;profile=mcp-app',text:'<script src="https://cdn.invalid/app.js"></script>'}]});
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    expect(view.resource).toBeNull(); expect(view.unsupported).toContain('outside'); expect(view.result.content).toEqual(result.content);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it('withholds a completed result after revocation and rejects stale handles', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    mocks.run.mockImplementationOnce(async (_action, _args, options) => {options.captureOriginalResult(result); entry.credentialRevision = 2; return {ok: true};});
    const invocation = randomUUID();
    await expect(callConnectedView(view.id, 'viewer', 'filter', {}, invocation)).rejects.toThrow('access changed');
    await expect(openConnectedView(view.captureId, 'viewer', chatId)).rejects.toThrow('access changed');
    await expect(callConnectedView(view.id, 'viewer', 'filter', {}, invocation)).rejects.toThrow('access changed');
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it('never retries a transport error that might follow an effect', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId), invocation = randomUUID();
    mocks.run.mockRejectedValueOnce(new Error('Lost connection after sending'));
    for (let i = 0; i < 2; i++) await expect(callConnectedView(view.id, 'viewer', 'filter', {}, invocation)).rejects.toThrow('Lost connection');
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it('launches explicitly with arguments and preserves a stable invocation across approvals', async () => {
    const {viewId, invocationId: invocation} = await prepareConnectedLaunch('server', 'viewer', 'calculate', {amount: 7});
    mocks.run.mockImplementationOnce(async (_action, _args, options) => {
      mocks.approvals.mockReturnValue([{id: 'approval', connectedApp: options.caller.connectedApp}]);
      return {ok: false, reason: 'approval_required', preview: {amount: 7}};
    });
    const paused = await launchConnectedView(viewId, 'viewer');
    expect(paused.kind).toBe('approval'); if (paused.kind !== 'approval') throw new Error('Expected approval');
    await expect(decideConnectedApproval(paused.viewId, 'other', ['approval'], true)).rejects.toThrow();
    await decideConnectedApproval(paused.viewId, 'viewer', ['approval'], true);
    const opened = await launchConnectedView(paused.viewId, 'viewer');
    expect(opened).toMatchObject({kind: 'opened', captureId: invocation});
    await launchConnectedView(viewId, 'viewer');
    expect(mocks.run).toHaveBeenCalledTimes(2);
    mcpViews().views.delete(viewId);
    await expect(launchConnectedView(viewId, 'viewer')).rejects.toThrow('expired');
    expect(mocks.run).toHaveBeenCalledTimes(2);
    await expect(openConnectedView(invocation, 'other')).rejects.toThrow('different viewer');
  });
  it('requires chat account access and rechecks frozen context before redispatch', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    const revision = await updateConnectedContext(view.id, 'viewer', {content: [{type: 'text', text: 'Selected 7'}]});
    const frozen = await freezeConnectedContext(chatId, 'viewer', [{viewId: view.id, revision}]);
    expect(await connectedTurnContext(chatId, frozen)).toMatchObject([{context: {content: [{text: 'Selected 7'}]}}]);
    await expect(freezeConnectedContext(randomUUID(), 'viewer', [{viewId: view.id, revision}])).rejects.toThrow('context changed');
    mocks.chat.mockReturnValue({id: chatId, status: 'idle', workspaceId: 'agent'}); mocks.workspace.mockReturnValue({integrationScopes: []});
    await expect(connectedTurnContext(chatId, frozen)).rejects.toThrow('not available');
  });
  it('enforces context limits and feature-off mode independently of local apps', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    await expect(updateConnectedContext(view.id, 'viewer', {text: 'a'.repeat(8192)})).rejects.toThrow('8 KiB');
    process.env.RI_MCP_APPS = '0';
    expect(await connectedAppsCatalog()).toEqual([]);
    await expect(openConnectedView(view.captureId, 'viewer', chatId)).rejects.toThrow('disabled');
  });
});
