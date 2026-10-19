import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMcpHandler, inputRequired, McpServer, fromJsonSchema } from '@modelcontextprotocol/server';
import { connectMcpClient, McpFormError, type ConnectedMcpClient } from '@integrations/engine/mcp';
import { bitsAndBoltsForms as bitsAndBolts } from '@/test/fixtures/bits-and-bolts-forms';

const mocks = vi.hoisted(() => ({ chat: vi.fn(), workspace: vi.fn(), placement: vi.fn(), insert: vi.fn(), attachments: '', references: vi.fn(), transport: vi.fn(), launch: vi.fn(), notify: vi.fn() }));
vi.mock('@/lib/db/queries', () => ({ getChatSessionWithExecution: mocks.chat, getWorkspace: mocks.workspace, chatPlacement: mocks.placement, insertChatEvent: mocks.insert }));
vi.mock('@/lib/config/paths', () => ({ getAttachmentsDir: () => mocks.attachments }));
vi.mock('@/lib/reference-folders/resolve', () => ({ listResolvedReferenceFolders: mocks.references }));
vi.mock('@/lib/integrations/runtime', () => ({ getMcpViewConnection: mocks.transport }));
vi.mock('./service', () => ({ prepareConnectedLaunch: mocks.launch }));
vi.mock('@/lib/notifications/emit', () => ({ notifyNeedsInput: mocks.notify }));

import { answerConnectedForm, answerMcpForm, connectedFormFile, connectedFormPreview, FORM_TTL_MS, getConnectedForm, isLocalMcpServer, listViewForms, mcpFormOptions, MCP_FORM_EVENT, MCP_FORM_RESPONSE_EVENT, prepareConnectedFormPreview } from './elicitation';

const chatId = '01a155c0-0000-7000-8000-00000000000a';
const otherChat = '01a155c0-0000-7000-8000-00000000000b';
const chatOrigin = (id = chatId) => ({ ownerId: 'local', connectionId: 'mcp-bb', actionId: 'mcp.bits_bolts.cad.pickFile', attemptId: 'a1', audience: 'model' as const, caller: { type: 'mcp' as const, id: `session:${id}` } });
const viewOrigin = (viewerId = 'viewer-1') => ({ ...chatOrigin(), audience: 'app' as const, caller: { type: 'mcp' as const, id: `session:${chatId}`, connectedApp: { viewId: 'view-1', invocationId: 'i1', sourceRef: 'ref', viewerId } } });
const openai = (schema: unknown, message = 'Choose a CAD part') => ({ method: 'openai/elicitation/create' as const, params: { mode: 'form', message, requestedSchema: schema } });
let dir: string;

beforeEach(() => {
  vi.useRealTimers();
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-forms-'));
  mocks.attachments = path.join(dir, 'attachments');
  fs.mkdirSync(mocks.attachments);
  for (const mock of [mocks.chat, mocks.workspace, mocks.placement, mocks.insert, mocks.references, mocks.transport, mocks.launch, mocks.notify]) mock.mockReset();
  mocks.chat.mockImplementation((id: string) => [chatId, otherChat].includes(id) ? { id, workspaceId: null } : undefined);
  mocks.placement.mockReturnValue(null);
  mocks.references.mockResolvedValue([]);
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** Start a form and wait for it to be listed, returning its id and the pending answer. */
async function ask(origin: unknown, request = openai(bitsAndBolts.pickFile), options: { local?: boolean; signal?: AbortSignal } = {}) {
  const before = mocks.insert.mock.calls.length;
  const answer = answerMcpForm({ serverId: 'bb', app: 'Bits & Bolts', local: options.local ?? false, request, signal: options.signal ?? new AbortController().signal, origin });
  answer.catch(() => {});
  await vi.waitFor(() => expect(mocks.insert.mock.calls.length > before || listViewForms('view-1', (origin as ReturnType<typeof viewOrigin>).caller.connectedApp?.viewerId ?? '').length).toBeTruthy());
  const event = mocks.insert.mock.calls.slice(before).find(([row]) => row.content === MCP_FORM_EVENT)?.[0];
  const id = event?.id ?? listViewForms('view-1', (origin as ReturnType<typeof viewOrigin>).caller.connectedApp!.viewerId).at(-1)!;
  return { id: id as string, answer };
}

describe('placing a form', () => {
  it('puts a model call\'s form in the chat that made the call, as a card and a notification', async () => {
    const { id, answer } = await ask(chatOrigin());
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ id, sessionId: chatId, source: 'system', content: MCP_FORM_EVENT }));
    await vi.waitFor(() => expect(mocks.notify).toHaveBeenCalledWith(expect.objectContaining({ sessionId: chatId, requestId: `mcp-form:${id}` })));
    expect(await getConnectedForm(id, 'any-viewer')).toMatchObject({ id, app: 'Bits & Bolts', message: 'Choose a CAD part', place: 'chat', chatId, status: 'open', local: false });
    await answerConnectedForm(id, 'any-viewer', { action: 'accept', content: { part: 'washer' } });
    await expect(answer).resolves.toEqual({ action: 'accept', content: { part: 'washer' } });
    expect(mocks.insert).toHaveBeenLastCalledWith(expect.objectContaining({ sessionId: chatId, content: MCP_FORM_RESPONSE_EVENT, raw: expect.objectContaining({ formId: id, outcome: 'accepted' }) }));
  });

  it('shows an app\'s own call\'s form in that view, to that viewer only, and nowhere in the chat', async () => {
    const { id, answer } = await ask(viewOrigin());
    expect(mocks.insert).not.toHaveBeenCalled();
    expect(listViewForms('view-1', 'viewer-1')).toEqual([id]);
    expect(listViewForms('view-1', 'viewer-2')).toEqual([]);
    await expect(getConnectedForm(id, 'viewer-2')).rejects.toThrow('no longer waiting');
    await expect(answerConnectedForm(id, 'viewer-2', { action: 'accept', content: { part: 'washer' } })).rejects.toThrow('no longer waiting');
    await answerConnectedForm(id, 'viewer-1', { action: 'decline' });
    await expect(answer).resolves.toEqual({ action: 'decline' });
    expect(listViewForms('view-1', 'viewer-1')).toEqual([]);
  });

  it('refuses a form it cannot place rather than guess, and keeps each chat\'s forms in that chat', async () => {
    const refused = (origin: unknown) => answerMcpForm({ serverId: 'bb', app: 'Bits & Bolts', local: false, request: openai(bitsAndBolts.pickFile), signal: new AbortController().signal, origin });
    await expect(refused(undefined)).rejects.toMatchObject({ reason: 'unrouted' });
    await expect(refused({ ...chatOrigin(), caller: { type: 'app' } })).rejects.toBeInstanceOf(McpFormError);
    await expect(refused(chatOrigin('01a155c0-0000-7000-8000-0000000000ff'))).rejects.toMatchObject({ reason: 'unrouted' });
    const a = await ask(chatOrigin(chatId));
    const b = await ask(chatOrigin(otherChat));
    expect(mocks.insert.mock.calls.filter(([row]) => row.content === MCP_FORM_EVENT).map(([row]) => [row.id, row.sessionId])).toEqual([[a.id, chatId], [b.id, otherChat]]);
    await answerConnectedForm(a.id, 'v', { action: 'cancel' });
    await answerConnectedForm(b.id, 'v', { action: 'cancel' });
  });
});

describe('answering', () => {
  it('returns field errors and keeps the form open until the answer is valid', async () => {
    const { id, answer } = await ask(chatOrigin(), openai(bitsAndBolts.reviewForm, 'Review M6 hex bolt'));
    expect(await answerConnectedForm(id, 'v', { action: 'accept', content: { reference: 'https://example.com', priority: 'urgent' } })).toEqual({ status: 'open', errors: {
      reference: 'This does not match the expected format.', priority: 'Choose one of the options.', approved: 'This is required.', tolerance: 'This is required.',
    } });
    await answerConnectedForm(id, 'v', { action: 'accept', content: { reference: 'cad://parts/hex-bolt', priority: 'high', checks: ['clearance', 'custom-gasket'], approved: true, tolerance: 0.2 } });
    await expect(answer).resolves.toEqual({ action: 'accept', content: { reference: 'cad://parts/hex-bolt', priority: 'high', checks: ['clearance', 'custom-gasket'], approved: true, tolerance: 0.2 } });
    await expect(answerConnectedForm(id, 'v', { action: 'decline' })).rejects.toThrow('no longer waiting');
  });

  it('cancels a form when its call ends or it expires, and says so in the chat', async () => {
    const controller = new AbortController();
    const first = await ask(chatOrigin(), undefined, { signal: controller.signal });
    controller.abort();
    await expect(first.answer).resolves.toEqual({ action: 'cancel' });
    expect(mocks.insert).toHaveBeenLastCalledWith(expect.objectContaining({ raw: expect.objectContaining({ formId: first.id, outcome: 'cancelled' }) }));
    vi.useFakeTimers();
    const second = answerMcpForm({ serverId: 'bb', app: 'Bits & Bolts', local: false, request: openai(bitsAndBolts.pickFile), signal: new AbortController().signal, origin: chatOrigin() });
    await vi.advanceTimersByTimeAsync(FORM_TTL_MS);
    await expect(second).resolves.toEqual({ action: 'cancel' });
    expect(mocks.insert).toHaveBeenLastCalledWith(expect.objectContaining({ raw: expect.objectContaining({ outcome: 'expired' }) }));
  });

  it('reports a form it cannot show as unsupported, in the chat and to the server, and shows none of it', async () => {
    const bad = { type: 'object', properties: { part: { type: 'string' }, address: { type: 'object', title: 'Shipping address' } } };
    await expect(answerMcpForm({ serverId: 'bb', app: 'Bits & Bolts', local: false, request: openai(bad), signal: new AbortController().signal, origin: chatOrigin() }))
      .rejects.toMatchObject({ reason: 'unsupported', message: 'Ri cannot show the form Bits & Bolts asked for. "Shipping address" uses an input type Ri does not support.' });
    expect(mocks.insert).toHaveBeenCalledTimes(1);
    expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ sessionId: chatId, content: MCP_FORM_RESPONSE_EVENT, raw: expect.objectContaining({ outcome: 'unsupported' }) }));
    // A 2026-07-28 round that left its extended schema out: the empty core form is never shown on its own.
    await expect(answerMcpForm({ serverId: 'bb', app: 'Bits & Bolts', local: false, signal: new AbortController().signal, origin: chatOrigin(),
      request: { method: 'elicitation/create', round: true, params: { mode: 'form', message: 'Pick', requestedSchema: { type: 'object', properties: {} } } } })).rejects.toMatchObject({ reason: 'unsupported' });
    await expect(answerMcpForm({ serverId: 'bb', app: 'Bits & Bolts', local: false, signal: new AbortController().signal, origin: chatOrigin(),
      request: { method: 'elicitation/create', params: { mode: 'url', message: 'Sign in', url: 'https://example.com' } } })).rejects.toMatchObject({ reason: 'unsupported' });
  });

  it('takes a 2026-07-28 form from its OpenAI schema, and a plain message-only form as one with no fields', async () => {
    const round = { method: 'elicitation/create' as const, round: true, params: { mode: 'form', message: 'Choose a part', requestedSchema: { type: 'object', properties: {} }, _meta: { 'openai/elicitation': { requestedSchema: bitsAndBolts.pickFile } } } };
    const { id, answer } = await ask(chatOrigin(), round as never);
    expect((await getConnectedForm(id, 'v')).schema).toEqual(bitsAndBolts.pickFile);
    await answerConnectedForm(id, 'v', { action: 'accept', content: { part: 'hex-bolt' } });
    await expect(answer).resolves.toEqual({ action: 'accept', content: { part: 'hex-bolt' } });
    const plain = await ask(chatOrigin(), { method: 'elicitation/create', params: { message: 'Part reference: M6 hex bolt', requestedSchema: { type: 'object', properties: {} } } } as never);
    await answerConnectedForm(plain.id, 'v', { action: 'accept', content: {} });
    await expect(plain.answer).resolves.toEqual({ action: 'accept', content: {} });
  });
});

describe('files a person adds', () => {
  it('offers user files only for a server on this computer', async () => {
    expect(isLocalMcpServer('http://localhost:3917/mcp')).toBe(true);
    expect(isLocalMcpServer('http://127.0.0.1:3916/bits-and-bolts/mcp')).toBe(true);
    expect(isLocalMcpServer('http://[::1]:3000/mcp')).toBe(true);
    expect(isLocalMcpServer('stdio:1password-mcp')).toBe(true);
    expect(isLocalMcpServer('https://mcp.example.com/mcp')).toBe(false);
    const remote = await ask(chatOrigin(), openai(bitsAndBolts.pickReferences('single')), { local: false });
    expect(await getConnectedForm(remote.id, 'v')).toMatchObject({ local: false, folders: [] });
    await expect(connectedFormFile(remote.id, 'v', 'references', { attachment: 'x.stl' })).rejects.toThrow('only takes the items it listed');
    expect(await answerConnectedForm(remote.id, 'v', { action: 'accept', content: { references: 'file:///Users/me/bracket.step' } })).toMatchObject({ errors: { references: 'Choose from the listed items.' } });
    await answerConnectedForm(remote.id, 'v', { action: 'cancel' });
  });

  it('turns an attachment or a file in the chat\'s agent folder into a file URI, checking kind, accept and containment', async () => {
    const agent = path.join(dir, 'agent');
    fs.mkdirSync(path.join(agent, 'parts'), { recursive: true });
    fs.writeFileSync(path.join(agent, 'parts', 'bracket.step'), 'ISO-10303-21;');
    fs.writeFileSync(path.join(agent, 'notes.txt'), 'notes');
    fs.writeFileSync(path.join(mocks.attachments, '01a155c0-aaaa.stl'), 'solid x');
    fs.writeFileSync(path.join(dir, 'secret.stl'), 'solid secret');
    mocks.chat.mockImplementation((id: string) => id === chatId ? { id, workspaceId: 'ws' } : undefined);
    mocks.workspace.mockReturnValue({ name: 'Parts', cwd: agent });
    const { id, answer } = await ask(chatOrigin(), openai(bitsAndBolts.pickReferences('explicit')), { local: true });
    const folder = pathToFileURL(agent).href;
    expect(await getConnectedForm(id, 'v')).toMatchObject({ local: true, folders: [{ label: 'Parts', uri: folder }] });
    const attachment = await connectedFormFile(id, 'v', 'references', { attachment: '01a155c0-aaaa.stl' });
    expect(attachment).toEqual({ uri: pathToFileURL(path.join(mocks.attachments, '01a155c0-aaaa.stl')).href, name: '01a155c0-aaaa.stl' });
    const step = await connectedFormFile(id, 'v', 'references', { folder, path: 'parts/bracket.step' });
    expect(step.name).toBe('bracket.step');
    await expect(connectedFormFile(id, 'v', 'references', { folder, path: 'notes.txt' })).rejects.toThrow('.stl, .3mf, .step, .stp');
    await expect(connectedFormFile(id, 'v', 'references', { folder, path: '../secret.stl' })).rejects.toThrow('leaves the folder');
    await expect(connectedFormFile(id, 'v', 'references', { folder, path: 'parts' })).rejects.toThrow('Choose a file');
    await expect(connectedFormFile(id, 'v', 'references', { attachment: '../secret.stl' })).rejects.toThrow('not valid');
    await expect(connectedFormFile(id, 'v', 'references', { folder: pathToFileURL(dir).href, path: 'secret.stl' })).rejects.toThrow('not one of this chat');
    // An answer cannot carry a file from outside what the form allowed.
    await expect(answerConnectedForm(id, 'v', { action: 'accept', content: { references: [pathToFileURL(path.join(dir, 'secret.stl')).href] } })).rejects.toThrow('outside this chat');
    await answerConnectedForm(id, 'v', { action: 'accept', content: { references: ['cad://parts/hex-bolt', attachment.uri, step.uri] } });
    await expect(answer).resolves.toEqual({ action: 'accept', content: { references: ['cad://parts/hex-bolt', attachment.uri, step.uri] } });
  });

  it('lets a local server\'s implicit selection take any file when it names no userOptions, and a remote one only its items', async () => {
    const agent = path.join(dir, 'agent');
    fs.mkdirSync(agent, { recursive: true });
    fs.writeFileSync(path.join(agent, 'bracket.obj'), 'o bracket');
    mocks.chat.mockImplementation((id: string) => id === chatId ? { id, workspaceId: 'ws' } : undefined);
    mocks.workspace.mockReturnValue({ name: 'Parts', cwd: agent });
    const schema = structuredClone(bitsAndBolts.pickReferences('implicit')) as { properties: { references: { 'x-openai-input': Record<string, unknown> } } };
    delete schema.properties.references['x-openai-input'].userOptions;
    const local = await ask(chatOrigin(), openai(schema as never), { local: true });
    // The chat's folders are offered only when a field takes added files.
    expect(await getConnectedForm(local.id, 'v')).toMatchObject({ local: true, folders: [{ label: 'Parts', uri: pathToFileURL(agent).href }] });
    // Any kind of file, since the server named no accept list.
    const added = await connectedFormFile(local.id, 'v', 'references', { folder: pathToFileURL(agent).href, path: 'bracket.obj' });
    await answerConnectedForm(local.id, 'v', { action: 'accept', content: { references: ['cad://parts/washer', added.uri] } });
    await expect(local.answer).resolves.toEqual({ action: 'accept', content: { references: ['cad://parts/washer', added.uri] } });
    const remote = await ask(chatOrigin(), openai(schema as never), { local: false });
    expect(await getConnectedForm(remote.id, 'v')).toMatchObject({ local: false, folders: [] });
    await expect(connectedFormFile(remote.id, 'v', 'references', { folder: pathToFileURL(agent).href, path: 'bracket.obj' })).rejects.toThrow('only takes the items it listed');
    expect(await answerConnectedForm(remote.id, 'v', { action: 'accept', content: { references: [added.uri] } })).toMatchObject({ errors: { references: 'Choose from the listed items.' } });
    await answerConnectedForm(remote.id, 'v', { action: 'cancel' });
  });

  it('names a folder for a directory input, and refuses a file there', async () => {
    const agent = path.join(dir, 'agent');
    fs.mkdirSync(path.join(agent, 'library'), { recursive: true });
    fs.writeFileSync(path.join(agent, 'a.stl'), 'x');
    mocks.chat.mockImplementation((id: string) => id === chatId ? { id, workspaceId: 'ws' } : undefined);
    mocks.workspace.mockReturnValue({ name: 'Parts', cwd: agent });
    const { id } = await ask(chatOrigin(), openai(bitsAndBolts.pickReferences('implicit', 'directory')), { local: true });
    const folder = pathToFileURL(agent).href;
    expect(await connectedFormFile(id, 'v', 'references', { folder, path: 'library' })).toEqual({ uri: pathToFileURL(path.join(agent, 'library')).href, name: 'library' });
    expect(await connectedFormFile(id, 'v', 'references', { folder })).toMatchObject({ uri: pathToFileURL(agent).href });
    await expect(connectedFormFile(id, 'v', 'references', { folder, path: 'a.stl' })).rejects.toThrow('Choose a folder');
    await answerConnectedForm(id, 'v', { action: 'cancel' });
  });
});

describe('previews', () => {
  it('reads only the resource links the form offers, from the asking server', async () => {
    const readResource = vi.fn(async () => ({ contents: [{ uri: 'cad://parts/hex-bolt', mimeType: 'text/markdown', text: '# M6 hex bolt' }] }));
    mocks.transport.mockResolvedValue({ readResource });
    const { id } = await ask(chatOrigin(), openai(bitsAndBolts.pickReferences('single')));
    expect(await connectedFormPreview(id, 'v', 'cad://parts/hex-bolt')).toEqual({ contents: [{ uri: 'cad://parts/hex-bolt', mimeType: 'text/markdown', text: '# M6 hex bolt' }] });
    expect(mocks.transport).toHaveBeenCalledWith('bb');
    await expect(connectedFormPreview(id, 'v', 'cad://parts/secret')).rejects.toThrow('does not offer');
    expect(readResource).toHaveBeenCalledTimes(1);
    await answerConnectedForm(id, 'v', { action: 'cancel' });
  });

  it('opens an app preview with exactly the arguments the form named, through the launch gate', async () => {
    mocks.launch.mockResolvedValue({ kind: 'launch', viewId: 'v-preview', invocationId: 'inv' });
    const { id } = await ask(chatOrigin(), openai(bitsAndBolts.pickReferences('single')));
    const args = { file: { name: 'washer.stl', resourceUri: 'cad://parts/washer' } };
    expect(await prepareConnectedFormPreview(id, 'v', 'cad.open', args)).toEqual({ kind: 'launch', viewId: 'v-preview', invocationId: 'inv' });
    expect(mocks.launch).toHaveBeenCalledWith('bb', 'v', 'cad.open', { kind: 'preview', args, chatId });
    await expect(prepareConnectedFormPreview(id, 'v', 'cad.open', { file: { name: 'x', resourceUri: 'cad://x' } })).rejects.toThrow('does not offer');
    await expect(prepareConnectedFormPreview(id, 'v', 'cad.delete', args)).rejects.toThrow('does not offer');
    await answerConnectedForm(id, 'v', { action: 'cancel' });
  });
});

describe('end to end through a real MCP server', () => {
  const servers: http.Server[] = [];
  const clients: ConnectedMcpClient[] = [];
  afterEach(async () => {
    await Promise.all(clients.splice(0).map(client => client.close().catch(() => {})));
    for (const server of servers.splice(0)) { server.closeAllConnections(); server.close(); }
  });
  async function listen(handle: (request: Request) => Promise<Response>) {
    const server = http.createServer(async (req, res) => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const headers = new Headers();
      for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
      const response = await handle(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(req.method === 'POST' ? { body: Buffer.concat(chunks) } : {}) }));
      res.writeHead(response.status, Object.fromEntries(response.headers));
      if (!response.body) return res.end();
      const reader = response.body.getReader();
      for (;;) { const part = await reader.read(); if (part.done) break; res.write(part.value); }
      res.end();
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    servers.push(server);
    return `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`;
  }

  it('answers a 2026-07-28 Bits & Bolts form from the chat card, and the tool sees the answer', async () => {
    const url = await listen(createMcpHandler(() => {
      const server = new McpServer({ name: 'bits-and-bolts', version: '1' }, { capabilities: { tools: {} } });
      server.registerTool('cad.pickFile', { inputSchema: fromJsonSchema({ type: 'object' }) }, async (_args, ctx) => {
        const answer = ctx.mcpReq.inputResponses?.part as { action: string; content?: { part?: string } } | undefined;
        if (answer) return { content: [{ type: 'text', text: `Opened ${answer.content?.part ?? answer.action}` }] };
        return inputRequired({ inputRequests: { part: inputRequired.elicit({ mode: 'form', message: 'Choose a CAD part', requestedSchema: { type: 'object', properties: {} },
          _meta: { 'openai/elicitation': { requestedSchema: bitsAndBolts.pickFile } } }) } });
      });
      return server;
    }).fetch);
    const client = await connectMcpClient({ url, ...mcpFormOptions({ id: 'bb', displayName: 'Bits & Bolts', url }) });
    clients.push(client);
    const call = client.callTool({ name: 'cad.pickFile', arguments: {} }, { origin: chatOrigin() });
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ content: MCP_FORM_EVENT, sessionId: chatId })));
    const formId = mocks.insert.mock.calls.find(([row]) => row.content === MCP_FORM_EVENT)![0].id;
    expect((await getConnectedForm(formId, 'v')).local).toBe(true);
    await answerConnectedForm(formId, 'v', { action: 'accept', content: { part: 'washer' } });
    expect(((await call).content as { text: string }[])[0]!.text).toBe('Opened washer');
  });

  it('answers a 2025-era openai/elicitation/create and refuses one it cannot place, as JSON-RPC', async () => {
    const waiting = new Map<string, (value: unknown) => void>();
    const url = await listen(async request => {
      const message = await request.json().catch(() => ({})) as { id?: string | number; method?: string; result?: unknown; error?: unknown };
      const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: message.id, result });
      if (message.method === 'initialize') return reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'bb-legacy', version: '1' } });
      if (message.method === 'tools/call') {
        const formId = `form-${String(message.id)}`;
        const answered = new Promise(resolve => waiting.set(formId, resolve));
        const encoder = new TextEncoder();
        return new Response(new ReadableStream({ async start(controller) {
          controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: formId, method: 'openai/elicitation/create', params: { mode: 'form', message: 'Review M6 hex bolt', requestedSchema: bitsAndBolts.reviewForm } })}\n\n`));
          const answer = await answered;
          controller.enqueue(encoder.encode(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(answer) }] } })}\n\n`));
          controller.close();
        } }), { headers: { 'content-type': 'text/event-stream' } });
      }
      if (typeof message.id === 'string' && waiting.has(message.id)) { waiting.get(message.id)!(message.result ?? { error: message.error }); return new Response(null, { status: 202 }); }
      return new Response(null, { status: request.method === 'GET' ? 405 : 202 });
    });
    const client = await connectMcpClient({ url, knownLegacy: true, ...mcpFormOptions({ id: 'bb', displayName: 'Bits & Bolts', url: 'https://bb.example/mcp' }) });
    clients.push(client);
    const call = client.callTool({ name: 'cad.reviewForm', arguments: {} }, { origin: chatOrigin() });
    await vi.waitFor(() => expect(mocks.insert).toHaveBeenCalledWith(expect.objectContaining({ content: MCP_FORM_EVENT })));
    const formId = mocks.insert.mock.calls.find(([row]) => row.content === MCP_FORM_EVENT)![0].id;
    await answerConnectedForm(formId, 'v', { action: 'accept', content: { reference: 'cad://parts/hex-bolt', priority: 'normal', approved: false, tolerance: 1 } });
    expect(JSON.parse(((await call).content as { text: string }[])[0]!.text)).toEqual({ action: 'accept', content: { reference: 'cad://parts/hex-bolt', priority: 'normal', approved: false, tolerance: 1 } });
    // A host-initiated run (no chat, no view) cannot take a form. The server hears why.
    const orphan = await client.callTool({ name: 'cad.reviewForm', arguments: {} }, { origin: { ...chatOrigin(), caller: { type: 'app' } } });
    expect(JSON.parse((orphan.content as { text: string }[])[0]!.text)).toEqual({ error: { code: -32603, message: 'Ri could not tell which chat asked for this form, so it was not shown.' } });
  });
});
