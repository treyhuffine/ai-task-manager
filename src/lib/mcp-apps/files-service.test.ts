import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const mocks = vi.hoisted(() => ({metadata: vi.fn(), runtime: vi.fn(), transport: vi.fn(), connections: vi.fn(), run: vi.fn(), read: vi.fn(), chat: vi.fn(), approvals: vi.fn()}));
vi.mock('@/lib/integrations/source-metadata', () => ({integrationSourceMetadata: mocks.metadata}));
vi.mock('@/lib/integrations/runtime', () => ({getIntegrationRuntime: mocks.runtime, getIntegrationOwnerId: () => 'local', getMcpViewConnection: mocks.transport}));
vi.mock('@/lib/db/queries', () => ({getChatSessionWithExecution: mocks.chat, getWorkspace: () => undefined, listWorkspaces: () => [], insertChatEvent: vi.fn()}));
vi.mock('@/lib/setups/run-on', () => ({agentDeviceFor: () => null}));
vi.mock('@/lib/integrations/approval', () => ({sessionCaller: (id: string) => ({type: 'mcp', id: `session:${id}`}), sessionIdFromCaller: () => null, listPendingApprovals: mocks.approvals, resolvePendingApprovals: vi.fn(), cancelConnectedAppApprovals: vi.fn(() => [])}));
vi.mock('@/lib/integrations/approval-events', () => ({recordApprovalDecision: vi.fn()}));
import { attachmentHandle } from './files';
import { callConnectedView, launchConnectedView, mcpViews, openConnectedView, prepareConnectedLaunch, readConnectedResource } from './service';

// Bits & Bolts' file viewer and the app-only tool that adds an opened file to its library by path.
const tools = [
  {name: 'cad.open', title: 'Bits & Bolts CAD viewer', _meta: {ui: {resourceUri: 'ui://bits-and-bolts/file-v35'}, 'openai/ui': {entrypoints: [{type: 'file', extensions: ['.stl', '.step']}]}}},
  {name: 'cad.addOpenFile', _meta: {ui: {visibility: ['app']}}},
];
const STL = 'solid bracket\nendsolid bracket\n';
let root: string, entry: Record<string, unknown>;
beforeEach(() => {
  vi.resetAllMocks(); delete process.env.RI_MCP_APPS;
  mcpViews().views.clear(); mcpViews().captures.clear();
  root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-file-views-')));
  process.env.RI_ROOT = root;
  fs.mkdirSync(path.join(root, 'attachments'));
  fs.writeFileSync(path.join(root, 'attachments', '01a1-bracket.stl'), STL);
  entry = {id: 'bnb', slug: 'bits_bolts', enabled: true, displayName: 'Bits & Bolts', url: 'http://localhost:3917/mcp', credentialRevision: 1, capabilityRevision: 'v1'};
  const connection = {id: 'mcp-bits_bolts', providerId: 'mcp_bits_bolts', ownerId: 'local', accountId: 'local', status: 'active', scopes: []};
  mocks.metadata.mockImplementation(async () => ({servers: [{entry, capabilities: {tools}}], connections: [connection], toolkits: []}));
  mocks.connections.mockResolvedValue([connection]);
  mocks.runtime.mockResolvedValue({listConnections: mocks.connections, runAction: mocks.run});
  mocks.transport.mockResolvedValue({tools, readResource: mocks.read});
  mocks.approvals.mockReturnValue([]);
  mocks.chat.mockReturnValue({id: 'chat', status: 'idle', workspaceId: null});
  mocks.run.mockImplementation(async (_action, _args, options) => { const result = {content: [{type: 'text', text: 'ok'}]}; options.captureOriginalResult(result); return {ok: true, result}; });
});
afterEach(() => { delete process.env.RI_ROOT; fs.rmSync(root, {recursive: true, force: true}); });

async function openFileView(chatId?: string) {
  const {handle} = await attachmentHandle('viewer', '01a1-bracket.stl', 'bracket.stl');
  const prepared = await prepareConnectedLaunch('bnb', 'viewer', 'cad.open', {kind: 'file', file: {handle}, ...(chatId ? {chatId} : {})});
  if (prepared.kind !== 'launch') throw new Error('Expected a launch');
  const launched = await launchConnectedView(prepared.viewId, 'viewer');
  if (launched.kind !== 'opened') throw new Error('Expected the view to open');
  return {handle, view: await openConnectedView(launched.captureId, 'viewer', chatId)};
}

it('opens a file with FileInput, reads it through Ri, and tells a local server where it is', async () => {
  const {handle, view} = await openFileView();
  expect(mocks.run.mock.calls[0]).toMatchObject(['mcp.bits_bolts.cad.open', {file: {name: 'bracket.stl', resourceUri: `ri-file:${handle}`}},
    {callMeta: {'openai/resource': {path: path.join(root, 'attachments', '01a1-bracket.stl')}}}]);
  expect(view).toMatchObject({kind: 'file', file: {name: 'bracket.stl'}});
  const read = await readConnectedResource(view.id, 'viewer', {uri: `ri-file:${handle}`});
  expect(read.contents[0]).toMatchObject({text: STL, _meta: {'openai/resource': {writable: false}}});
  // Only the UI resource went to the server. The file never did.
  expect(mocks.read.mock.calls.map(([params]) => params.uri)).toEqual(['ui://bits-and-bolts/file-v35']);
  // The app's own calls from the file view carry the path too.
  await callConnectedView(view.id, 'viewer', 'cad.addOpenFile', {fileName: 'bracket.stl'}, randomUUID());
  expect(mocks.run.mock.calls[1][2]).toMatchObject({callMeta: {'openai/resource': {path: path.join(root, 'attachments', '01a1-bracket.stl')}}});
});

it('keeps the path from a server on another computer', async () => {
  entry.url = 'https://bits.example/mcp';
  const {view} = await openFileView();
  expect(mocks.run.mock.calls[0][2]).not.toHaveProperty('callMeta');
  await callConnectedView(view.id, 'viewer', 'cad.addOpenFile', {fileName: 'bracket.stl'}, randomUUID());
  expect(mocks.run.mock.calls[1][2]).not.toHaveProperty('callMeta');
});

it('opens a chat attachment beside that chat, and never as another kind of launch', async () => {
  const {view} = await openFileView('chat');
  expect(view.chatId).toBe('chat');
  const {handle} = await attachmentHandle('viewer', '01a1-bracket.stl');
  await expect(prepareConnectedLaunch('bnb', 'viewer', 'cad.addOpenFile', {kind: 'file', file: {handle}})).rejects.toThrow('does not open files');
  await expect(prepareConnectedLaunch('bnb', 'someone-else', 'cad.open', {kind: 'file', file: {handle}})).rejects.toThrow('no longer open');
});
