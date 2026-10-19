import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
const mocks = vi.hoisted(() => ({metadata: vi.fn(), runtime: vi.fn(), transport: vi.fn(), connections: vi.fn(), run: vi.fn(), read: vi.fn(), chat: vi.fn(), workspace: vi.fn(), insert: vi.fn(), approvals: vi.fn(), decide: vi.fn(), cancel: vi.fn()}));
vi.mock('@/lib/integrations/source-metadata', () => ({integrationSourceMetadata: mocks.metadata}));
vi.mock('@/lib/integrations/runtime', () => ({getIntegrationRuntime: mocks.runtime, getIntegrationOwnerId: () => 'local', getMcpViewConnection: mocks.transport}));
vi.mock('@/lib/db/queries', () => ({getChatSessionWithExecution: mocks.chat, getWorkspace: mocks.workspace, insertChatEvent: mocks.insert}));
vi.mock('@/lib/integrations/approval', () => ({sessionCaller: (id: string) => ({type: 'mcp', id: `session:${id}`}), sessionIdFromCaller: (caller?: {type?: string; id?: string}) => caller?.type === 'mcp' && caller.id?.startsWith('session:') ? caller.id.slice(8) : null, listPendingApprovals: mocks.approvals, resolvePendingApprovals: mocks.decide, cancelConnectedAppApprovals: mocks.cancel}));
vi.mock('@/lib/integrations/approval-events', () => ({recordApprovalDecision: vi.fn()}));
import { prepareMcpResultCapture, connectedAppsCatalog, openConnectedView, callConnectedView, cancelConnectedInvocation, launchConnectedView, prepareConnectedLaunch, mcpViews, updateConnectedContext, clearConnectedContext, freezeConnectedContext, connectedTurnContext, decideConnectedApproval, navigateConnectedScreen, normalizeDeepLink, readConnectedResource, connectedMessageSender } from './service';

const chatId = randomUUID();
const result = {content: [{type: 'text', text: 'Public summary'}], structuredContent: {total: 42}, _meta: {privateUi: 'Only for the interface'}};
const tools: {name: string; title?: string; inputSchema?: unknown; _meta?: unknown}[] = [
  {name: 'calculate', inputSchema: {type: 'object', properties: {amount: {type: 'number'}}, required: ['amount']}, _meta: {ui: {resourceUri: 'ui://fixture/calculator.html'}}},
  {name: 'filter', _meta: {ui: {visibility: ['app']}}},
  {name: 'model_only', _meta: {ui: {visibility: ['model']}}},
];
/** A standalone screen as OpenAI's MCP extensions spec declares one: a global entrypoint on an app-only tool. */
const launcher = {name: 'home', title: 'Fixture home', _meta: {ui: {resourceUri: 'ui://fixture/calculator.html', visibility: ['app']}, 'openai/ui': {entrypoints: [{type: 'global'}]}}};
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
/** A launch that must start a new instance. */
async function launchRequest(...args: Parameters<typeof prepareConnectedLaunch>) {
  const prepared = await prepareConnectedLaunch(...args);
  if (prepared.kind !== 'launch') throw new Error('Expected a new launch');
  return prepared;
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
    // Its interface only comes back as a tool result, so it is an app with no screen of its own.
    expect(await connectedAppsCatalog()).toMatchObject([{id: 'server', available: true, standalone: false, entrypoints: [], views: [{name: 'calculate', title: 'calculate'}]}]);
    expect(mocks.runtime).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it('treats only a global entrypoint as a standalone screen, whatever its tool visibility', async () => {
    const thread = {name: 'tray', title: 'Parts tray', _meta: {ui: {resourceUri: 'ui://fixture/tray.html'}, 'openai/ui': {entrypoints: [{type: 'thread'}]}}};
    tools.push(thread);
    try { expect((await connectedAppsCatalog())[0]).toMatchObject({standalone: false, entrypoints: []}); }
    finally { tools.splice(tools.indexOf(thread), 1); }
    tools.push(launcher);
    try {
      expect((await connectedAppsCatalog())[0]).toMatchObject({standalone: true, entrypoints: [{name: 'home', title: 'Fixture home'}], views: [{name: 'calculate'}]});
      // An app-only launcher with no model-visible result view is still an app you can open.
      const only = [launcher];
      mocks.metadata.mockImplementation(async () => ({servers: [{entry, capabilities: {tools: only}}], connections: [], toolkits: []}));
      expect(await connectedAppsCatalog()).toMatchObject([{id: 'server', standalone: true, views: []}]);
      entry.toolOverrides = {home: {enabled: false}};
      expect(await connectedAppsCatalog()).toEqual([]);
    } finally { tools.splice(tools.indexOf(launcher), 1); }
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
  it('opens only a standalone screen, with no arguments, and never runs another tool from the page', async () => {
    await expect(prepareConnectedLaunch('server', 'viewer', 'calculate')).rejects.toThrow('Try it in chat');
    await expect(prepareConnectedLaunch('server', 'viewer', 'filter')).rejects.toThrow('Try it in chat');
    expect(mocks.run).not.toHaveBeenCalled();
    tools.push(launcher);
    try {
      const {viewId} = await launchRequest('server', 'viewer', 'home');
      expect(await launchConnectedView(viewId, 'viewer')).toMatchObject({kind: 'opened'});
      // The spec has the server accept `{}`, and lets an app-only launcher open, so it runs with the app audience.
      expect(mocks.run.mock.calls[0]).toMatchObject(['mcp.fixture.home', {}, {connectionId: 'mcp-fixture', toolAudience: 'app'}]);
      // A screen the person opened is listed as one, so it reopens full screen.
      expect((await connectedAppsCatalog('viewer'))[0].recent).toMatchObject([{title: 'Fixture · Fixture home', launched: true}]);
      await capture();
      expect((await connectedAppsCatalog('viewer'))[0].recent.map(item => item.launched)).toEqual([true, false]);
    } finally { tools.splice(tools.indexOf(launcher), 1); }
  });
  it('launches a standalone screen and preserves a stable invocation across approvals', async () => {
    tools.push(launcher);
    const {viewId, invocationId: invocation} = await launchRequest('server', 'viewer', 'home');
    mocks.run.mockImplementationOnce(async (_action, _args, options) => {
      mocks.approvals.mockReturnValue([{id: 'approval', connectedApp: options.caller.connectedApp}]);
      return {ok: false, reason: 'approval_required', preview: {}};
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
    tools.splice(tools.indexOf(launcher), 1);
  });
  it('requires chat account access and rechecks frozen context before redispatch', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    const {revision} = await updateConnectedContext(view.id, 'viewer', {content: [{type: 'text', text: 'Selected 7'}]});
    const frozen = await freezeConnectedContext(chatId, 'viewer', [{viewId: view.id, revision}]);
    expect(await connectedTurnContext(chatId, frozen)).toMatchObject([{context: {content: [{text: 'Selected 7'}]}}]);
    await expect(freezeConnectedContext(randomUUID(), 'viewer', [{viewId: view.id, revision}])).rejects.toThrow('context changed');
    mocks.chat.mockReturnValue({id: chatId, status: 'idle', workspaceId: 'agent'}); mocks.workspace.mockReturnValue({integrationScopes: []});
    await expect(connectedTurnContext(chatId, frozen)).rejects.toThrow('not available');
  });
  it('enforces context limits and feature-off mode independently of local apps', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    await expect(updateConnectedContext(view.id, 'viewer', {text: 'a'.repeat(768 * 1024)})).rejects.toThrow('768 KiB');
    await expect(updateConnectedContext(view.id, 'viewer', {content: [{type: 'audio', data: 'AA==', mimeType: 'audio/wav'}]})).rejects.toThrow('audio');
    process.env.RI_MCP_APPS = '0';
    expect(await connectedAppsCatalog()).toEqual([]);
    await expect(openConnectedView(view.captureId, 'viewer', chatId)).rejects.toThrow('disabled');
  });
});

describe('OpenAI entrypoints, deep links, resources and model context', () => {
  const tray = {name: 'tray', title: 'Parts Tray', _meta: {ui: {resourceUri: 'ui://fixture/calculator.html'}, 'openai/ui': {entrypoints: [{type: 'thread'}]}}};
  const viewer = {name: 'viewer', _meta: {ui: {resourceUri: 'ui://fixture/calculator.html'}, 'openai/ui': {entrypoints: [{type: 'file', extensions: ['.stl']}]}}};
  const withTools = async (extra: typeof tools, run: () => Promise<void>) => {
    tools.push(...extra);
    try { await run(); } finally { for (const tool of extra) tools.splice(tools.indexOf(tool), 1); }
  };

  it('lists thread and file entrypoints with titles and the server icon', async () => {
    entry.protocol = {checkedAt: 'now', info: {icons: [{src: 'https://fixture.invalid/icon.png'}]}, extensions: {'openai/settings': {readTool: 'r', updateTool: 'u'}}};
    await withTools([launcher, tray, viewer], async () => {
      const [app] = await connectedAppsCatalog('viewer');
      expect(app).toMatchObject({
        entrypoints: [{name: 'home', title: 'Fixture home', icons: [{src: 'https://fixture.invalid/icon.png'}]}],
        threads: [{name: 'tray', title: 'Parts Tray'}],
        files: [{name: 'viewer', title: 'viewer', extensions: ['.stl']}],
        settings: true, mentions: false,
      });
    });
  });

  it('opens one tab per chat beside that chat only, with {} and through the gate, and reuses it', async () => {
    await withTools([tray], async () => {
      await expect(prepareConnectedLaunch('server', 'viewer', 'tray', {kind: 'thread'})).rejects.toThrow('beside a chat');
      await expect(prepareConnectedLaunch('server', 'viewer', 'tray')).rejects.toThrow('no screen');
      const first = await launchRequest('server', 'viewer', 'tray', {kind: 'thread', chatId});
      expect(await launchConnectedView(first.viewId, 'viewer')).toMatchObject({kind: 'opened', captureId: first.invocationId});
      expect(mocks.run.mock.calls[0]).toMatchObject(['mcp.fixture.tray', {}, {toolAudience: 'model'}]);
      // Opening the tab again in the same chat returns to it. Another chat gets its own instance.
      expect(await prepareConnectedLaunch('server', 'viewer', 'tray', {kind: 'thread', chatId})).toEqual({kind: 'open', captureId: first.invocationId});
      expect((await prepareConnectedLaunch('server', 'viewer', 'tray', {kind: 'thread', chatId: randomUUID()})).kind).toBe('launch');
      expect((await prepareConnectedLaunch('server', 'viewer', 'tray', {kind: 'thread', chatId, fresh: true})).kind).toBe('launch');
      // A tab is not a recent result to reopen from the app's page.
      expect((await connectedAppsCatalog('viewer'))[0].recent).toEqual([]);
      expect(mocks.run).toHaveBeenCalledTimes(1);
    });
  });

  it('never lets a model result or another tool stand in for an entrypoint', async () => {
    await withTools([tray], async () => {
      const view = await openConnectedView(await capture(), 'viewer', chatId);
      await expect(launchConnectedView(view.id, 'viewer')).rejects.toThrow('not a launch request');
      await expect(prepareConnectedLaunch('server', 'viewer', 'calculate', {kind: 'thread', chatId})).rejects.toThrow('no tab');
      await expect(prepareConnectedLaunch('server', 'viewer', 'tray', {kind: 'settings'})).rejects.toThrow('no interface');
    });
  });

  it('carries a deep link into a new global screen, and moves an open one with it', async () => {
    await withTools([launcher], async () => {
      await expect(prepareConnectedLaunch('server', 'viewer', 'home', {deepLink: 'parts'})).rejects.toThrow('starts with /');
      await expect(prepareConnectedLaunch('server', 'viewer', 'home', {deepLink: '/parts#top'})).rejects.toThrow('fragment');
      const launched = await launchRequest('server', 'viewer', 'home', {deepLink: '/parts?tag=bolt&sort=asc'});
      await launchConnectedView(launched.viewId, 'viewer');
      const opened = await openConnectedView(launched.invocationId, 'viewer');
      expect(opened).toMatchObject({kind: 'global', deepLink: '/parts?tag=bolt&sort=asc'});
      expect(await prepareConnectedLaunch('server', 'viewer', 'home', {deepLink: '/parts/hex-bolt'})).toEqual({kind: 'open', captureId: launched.invocationId, deepLink: '/parts/hex-bolt'});
      expect(await navigateConnectedScreen(opened.id, 'viewer', '/parts/washer')).toEqual({deepLink: '/parts/washer'});
      expect((await openConnectedView(launched.invocationId, 'viewer')).deepLink).toBe('/parts/washer');
      expect(normalizeDeepLink(undefined)).toBeUndefined();
      expect(() => normalizeDeepLink('//evil.example/')).toThrow();
    });
  });

  it('relays a view\'s resource reads to its own server on the same account, and refuses the file seam plainly', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    mocks.read.mockResolvedValueOnce({contents: [{uri: 'cad-resource://bits-and-bolts/occt-import-js.wasm', mimeType: 'application/wasm', blob: 'AGFzbQ=='}]});
    expect(await readConnectedResource(view.id, 'viewer', {uri: 'cad-resource://bits-and-bolts/occt-import-js.wasm'})).toMatchObject({contents: [{blob: 'AGFzbQ=='}]});
    expect(mocks.read).toHaveBeenLastCalledWith({uri: 'cad-resource://bits-and-bolts/occt-import-js.wasm'});
    await expect(readConnectedResource(view.id, 'other', {uri: 'cad://parts/x'})).rejects.toThrow('unavailable');
    await expect(readConnectedResource(view.id, 'viewer', {uri: 'not a uri'})).rejects.toThrow('Invalid resource URI');
    entry.enabled = false;
    await expect(readConnectedResource(view.id, 'viewer', {uri: 'cad://parts/x'})).rejects.toThrow('disabled');
  });

  it('keeps titled, thumbnailed and assistant-only context, names each change, and keeps _meta from the model', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    const block = {type: 'text', text: 'Selected: agent dial', _meta: {'openai/title': 'Agent dial', 'openai/thumbnail': {src: 'https://example.com/dial.png'}, private: 'drop'}};
    const hidden = {type: 'text', text: 'Current part: hex-bolt', annotations: {audience: ['assistant']}};
    const first = await updateConnectedContext(view.id, 'viewer', {content: [block, hidden]});
    expect(first.updateId).toMatch(/^[0-9a-f-]{36}$/);
    const same = await updateConnectedContext(view.id, 'viewer', {content: [block, hidden]});
    expect(same.updateId).toBe(first.updateId);
    const reopened = await openConnectedView(view.captureId, 'viewer', chatId);
    expect(reopened.modelContext).toEqual({updateId: first.updateId, content: [
      {type: 'text', text: 'Selected: agent dial', _meta: {'openai/title': 'Agent dial', 'openai/thumbnail': {src: 'https://example.com/dial.png'}}}, hidden]});
    const frozen = await freezeConnectedContext(chatId, 'viewer', [{viewId: view.id, revision: same.revision}]);
    expect(await connectedTurnContext(chatId, frozen)).toMatchObject([{context: {content: [{type: 'text', text: 'Selected: agent dial'}, hidden]}}]);
    expect(JSON.stringify(await connectedTurnContext(chatId, frozen))).not.toContain('Agent dial');
    const changed = await updateConnectedContext(view.id, 'viewer', {content: [{type: 'text', text: 'Selected: washer'}]});
    expect(changed.updateId).not.toBe(first.updateId);
    await clearConnectedContext(view.id, 'viewer');
    expect((await openConnectedView(view.captureId, 'viewer', chatId)).modelContext).toBeNull();
  });

  it('attaches a global screen\'s context to whichever chat its person sends in', async () => {
    await withTools([launcher], async () => {
      const launched = await launchRequest('server', 'viewer', 'home');
      await launchConnectedView(launched.viewId, 'viewer');
      const screen = await openConnectedView(launched.invocationId, 'viewer');
      const {revision} = await updateConnectedContext(screen.id, 'viewer', {content: [{type: 'text', text: 'Library page'}]});
      expect(await freezeConnectedContext(chatId, 'viewer', [{viewId: screen.id, revision}])).toMatchObject([{context: {content: [{text: 'Library page'}]}}]);
    });
  });
});

describe('OpenAI model context files and app messages', () => {
  const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

  it('freezes an image in context as an attachment marker, never its bytes, and hands the model the marker', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    const {revision} = await updateConnectedContext(view.id, 'viewer', {content: [{type: 'image', data: PIXEL, mimeType: 'image/png', _meta: {'openai/title': 'Front view'}}]});
    const frozen = await freezeConnectedContext(chatId, 'viewer', [{viewId: view.id, revision}]);
    expect(JSON.stringify(frozen)).not.toContain(PIXEL);
    const [item] = frozen as unknown as {files: {fileName: string; mimeType: string}[]; context: {content: {file: string}[]}}[];
    expect(item!.files).toEqual([expect.objectContaining({mimeType: 'image/png', originalName: 'Front view'})]);
    expect(item!.context.content[0]!.file).toBe(`[[file:${item!.files[0]!.fileName}]]`);
    const turn = await connectedTurnContext(chatId, frozen);
    expect(turn).toEqual([{sourceRef: view.sourceRef, app: 'Fixture', context: {content: [{type: 'image', mimeType: 'image/png', file: `[[file:${item!.files[0]!.fileName}]]`}]}}]);
    // A second send with the same context reuses the same file.
    const again = await freezeConnectedContext(chatId, 'viewer', [{viewId: view.id, revision}]) as unknown as typeof frozen;
    expect((again[0] as unknown as {files: {fileName: string}[]}).files[0]!.fileName).toBe(item!.files[0]!.fileName);
  });

  it('names the app behind a message only for the viewer of a live view it may still use', async () => {
    const view = await openConnectedView(await capture(), 'viewer', chatId);
    expect(await connectedMessageSender(view.id, 'viewer')).toEqual({app: 'Fixture', serverId: 'server', viewId: view.id});
    await expect(connectedMessageSender(view.id, 'other')).rejects.toThrow('unavailable');
    entry.enabled = false;
    await expect(connectedMessageSender(view.id, 'viewer')).rejects.toThrow('disabled');
  });
});
