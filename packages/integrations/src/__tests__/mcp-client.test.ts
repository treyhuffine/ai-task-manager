/**
 * `connectMcpClient` against real MCP servers built on the v2 SDK: Streamable HTTP on a loopback
 * port and a stdio child process, on both protocol eras. No SDK internals are mocked here, so the
 * wire behavior (the 2026-07-28 probe, its fallback, subscriptions and multi-round-trip input) is
 * what a hosted or local server would see. Error classification has its own file.
 */
import fs from 'node:fs';
import http from 'node:http';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createMcpHandler, fromJsonSchema, inputRequired, legacyStatelessFallback, McpServer,
  type McpServerFactory,
} from '@modelcontextprotocol/server';
import { connectMcpClient, isMcpAuthenticationError, McpFormError, type ConnectedMcpClient } from '../mcp/client';
import { IntegrationError } from '../core/errors';

const text = (result: { content: unknown }) => (result.content as { text: string }[])[0]!.text;

const object = fromJsonSchema({ type: 'object', properties: { query: { type: 'string' } } });
const icon = { src: 'data:image/svg+xml,%3Csvg%2F%3E', mimeType: 'image/svg+xml', sizes: ['any'] };
const servers: { close(): Promise<void> }[] = [];
const clients: ConnectedMcpClient[] = [];
afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.close().catch(() => {})));
  await Promise.all(servers.splice(0).map(server => server.close()));
});

/** A loopback HTTP server around a web-standard handler, recording each JSON-RPC method it saw. */
async function serve(handle: (request: Request) => Promise<Response>) {
  const methods: string[] = [];
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = Buffer.concat(chunks);
    try { methods.push(JSON.parse(body.toString() || '{}').method ?? req.method); } catch { methods.push(String(req.method)); }
    const headers = new Headers();
    for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
    const response = await handle(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(req.method === 'POST' ? { body } : {}) }));
    res.writeHead(response.status, Object.fromEntries(response.headers));
    if (!response.body) { res.end(); return; }
    const reader = response.body.getReader();
    req.on('close', () => { void reader.cancel().catch(() => {}); });
    for (;;) {
      const part = await reader.read().catch(() => ({ done: true, value: undefined }));
      if (part.done) break;
      res.write(part.value);
    }
    res.end();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const close = () => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
  servers.push({ close });
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, methods };
}

/** Tools with MCP Apps and OpenAI metadata, a UI resource, and a custom server capability. */
const appServer: McpServerFactory = () => {
  const server = new McpServer({ name: 'fixture-app', title: 'Fixture App', version: '1.0.0', icons: [icon] }, {
    capabilities: { tools: { listChanged: true }, resources: {}, extensions: { 'openai/settings': { readTool: 'settings.read', updateTool: 'settings.update' } } },
  });
  server.registerTool('open', {
    title: 'Open the library', inputSchema: object, icons: [icon],
    annotations: { readOnlyHint: true },
    _meta: { ui: { resourceUri: 'ui://fixture/app.html', visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'global' }] } },
  }, async () => ({ content: [{ type: 'text', text: 'Opened' }], structuredContent: { page: 'library' }, _meta: { privateUi: 'view only' } }));
  server.registerResource('app', 'ui://fixture/app.html', { mimeType: 'text/html;profile=mcp-app' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: '<main>View</main>', _meta: { 'openai/ui': { availableDisplayModes: ['fullscreen'] } } }],
  }));
  // A page the server says may be reused for a minute (SEP-2549 `ttlMs`).
  server.registerResource('cached', 'ui://fixture/cached.html', { mimeType: 'text/html;profile=mcp-app' }, async uri => ({
    contents: [{ uri: uri.href, mimeType: 'text/html;profile=mcp-app', text: '<main>Cached</main>' }], ttlMs: 60_000,
  }) as never);
  server.registerTool('ask', { inputSchema: object }, async (_args, ctx) => {
    const answer = ctx.mcpReq.inputResponses?.form as { action?: string; content?: Record<string, unknown> } | undefined;
    if (answer) return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
    return inputRequired({ inputRequests: { form: inputRequired.elicit({
      mode: 'form', message: 'Choose a part', requestedSchema: { type: 'object', properties: { part: { type: 'string' } }, required: ['part'] },
      _meta: { 'openai/elicitation': { requestedSchema: { type: 'object', properties: { part: { type: 'string', 'x-openai-suggestions': [{ const: 'bolt', title: 'Bolt' }] } } } } },
    }) } });
  });
  return server;
};

/** Two forms in turn, carrying the first answer in the server's opaque state, as a stateless server must. */
const twoFormServer: McpServerFactory = () => {
  const server = new McpServer({ name: 'two-forms', version: '1.0.0' }, { capabilities: { tools: {} } });
  server.registerTool('askTwice', { inputSchema: object }, async (_args, ctx) => {
    const responses = ctx.mcpReq.inputResponses as Record<string, { content?: Record<string, unknown> }> | undefined;
    if (responses?.second) return { content: [{ type: 'text', text: JSON.stringify({ first: ctx.mcpReq.requestState?.(), second: responses.second.content }) }] };
    if (responses?.first) return inputRequired({ requestState: JSON.stringify(responses.first.content), inputRequests: { second: inputRequired.elicit({
      mode: 'form', message: 'Second', requestedSchema: { type: 'object', properties: { size: { type: 'number' } } },
    }) } });
    return inputRequired({ inputRequests: { first: inputRequired.elicit({ mode: 'form', message: 'First', requestedSchema: { type: 'object', properties: { part: { type: 'string' } } } }) } });
  });
  return server;
};

/**
 * A 2025-era Streamable HTTP server that keeps sessions, written by hand: each tool call's
 * response stream carries an `openai/elicitation/create` request before the result, as a
 * stateful 2025 server sends one. The answer arrives as a separate POST.
 */
async function legacyFormServer() {
  const waiting = new Map<string, (result: unknown) => void>();
  return serve(async request => {
    const message = await request.json().catch(() => ({})) as { id?: string | number; method?: string; params?: { arguments?: { tag?: string } }; result?: unknown; error?: unknown };
    const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: message.id, result });
    if (message.method === 'initialize') return reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'legacy-forms', version: '1' } });
    if (message.method === 'tools/list') return reply({ tools: [{ name: 'ask', inputSchema: { type: 'object' } }] });
    if (message.method === 'tools/call') {
      const formId = `form-${String(message.id)}`;
      const tag = message.params?.arguments?.tag ?? '';
      const answered = new Promise<unknown>(resolve => waiting.set(formId, resolve));
      const encoder = new TextEncoder();
      const stream = new ReadableStream({ async start(controller) {
        controller.enqueue(encoder.encode(`event: message
data: ${JSON.stringify({ jsonrpc: '2.0', id: formId, method: 'openai/elicitation/create', params: { mode: 'form', message: `Form for ${tag}`, requestedSchema: { type: 'object', properties: {} } } })}

`));
        const answer = await answered;
        controller.enqueue(encoder.encode(`event: message
data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { content: [{ type: 'text', text: JSON.stringify(answer) }] } })}

`));
        controller.close();
      } });
      return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
    }
    if (typeof message.id === 'string' && waiting.has(message.id)) {
      waiting.get(message.id)!(message.result ?? { error: message.error });
      waiting.delete(message.id);
      return new Response(null, { status: 202 });
    }
    if (request.method === 'GET') return new Response(null, { status: 405 });
    return new Response(null, { status: 202 });
  });
}

describe('connectMcpClient over Streamable HTTP', () => {
  it('speaks 2026-07-28 to a server that offers it and keeps every UI, icon and result field', async () => {
    const handler = createMcpHandler(appServer);
    const { url, methods } = await serve(request => handler.fetch(request));
    const client = await connectMcpClient({ url });
    clients.push(client);
    expect(client.server).toMatchObject({ protocolVersion: '2026-07-28', era: 'modern', negotiation: 'probe', info: { name: 'fixture-app', title: 'Fixture App', icons: [icon] } });
    expect(client.server?.capabilities?.extensions).toMatchObject({ 'openai/settings': { readTool: 'settings.read', updateTool: 'settings.update' } });
    const { tools } = await client.listTools();
    expect(tools.find(tool => tool.name === 'open')).toMatchObject({
      title: 'Open the library', icons: [icon], annotations: { readOnlyHint: true },
      _meta: { ui: { resourceUri: 'ui://fixture/app.html', visibility: ['app'] }, 'openai/ui': { entrypoints: [{ type: 'global' }] } },
    });
    expect(await client.callTool({ name: 'open', arguments: {} })).toEqual({
      content: [{ type: 'text', text: 'Opened' }], structuredContent: { page: 'library' }, isError: false, _meta: expect.objectContaining({ privateUi: 'view only' }),
    });
    expect((await client.readResource({ uri: 'ui://fixture/app.html' })).contents).toEqual([
      { uri: 'ui://fixture/app.html', mimeType: 'text/html;profile=mcp-app', text: '<main>View</main>', _meta: { 'openai/ui': { availableDisplayModes: ['fullscreen'] } } },
    ]);
    expect(methods[0]).toBe('server/discover');
    expect(methods).not.toContain('initialize');
  });

  it('reads a resource from the server every time, whatever its cache hint', async () => {
    const handler = createMcpHandler(appServer);
    const { url, methods } = await serve(request => handler.fetch(request));
    const client = await connectMcpClient({ url });
    clients.push(client);
    for (let i = 0; i < 2; i++) expect((await client.readResource({ uri: 'ui://fixture/cached.html' })).contents[0]).toMatchObject({ text: '<main>Cached</main>' });
    expect(methods.filter(method => method === 'resources/read')).toHaveLength(2);
  });

  it('falls back to the 2025 handshake for a server that predates 2026-07-28', async () => {
    const legacy = legacyStatelessFallback(appServer);
    const { url, methods } = await serve(request => legacy(request));
    const client = await connectMcpClient({ url });
    clients.push(client);
    expect(client.server).toMatchObject({ era: 'legacy', protocolVersion: '2025-11-25', negotiation: 'probe', info: { name: 'fixture-app' } });
    expect(client.server?.capabilities?.extensions).toMatchObject({ 'openai/settings': { readTool: 'settings.read' } });
    expect((await client.listTools()).tools.map(tool => tool.name)).toEqual(['open', 'ask']);
    expect(await client.callTool({ name: 'open', arguments: {} })).toMatchObject({ structuredContent: { page: 'library' } });
    expect(methods.slice(0, 2)).toEqual(['server/discover', 'initialize']);
  });

  it('retries as a 2025 client when a legacy server fails the unknown discovery probe', async () => {
    const legacy = legacyStatelessFallback(appServer);
    const { url, methods } = await serve(async request => {
      const body = await request.clone().text();
      // A server that crashes on an unknown method instead of answering it.
      if (body.includes('"server/discover"')) return new Response('Internal Server Error', { status: 500 });
      return legacy(request);
    });
    const client = await connectMcpClient({ url });
    clients.push(client);
    expect(client.server).toMatchObject({ era: 'legacy', negotiation: 'fallback' });
    expect((await client.listTools()).tools).toHaveLength(2);
    expect(methods.filter(method => method === 'server/discover')).toHaveLength(1);
  });

  it('gives a server that never answers the probe one plain 2025 attempt', async () => {
    const legacy = legacyStatelessFallback(appServer);
    const { url } = await serve(async request => {
      // A server that holds an unknown request open instead of answering it.
      if ((await request.clone().text()).includes('"server/discover"')) return new Promise<Response>(() => {});
      return legacy(request);
    });
    const client = await connectMcpClient({ url });
    clients.push(client);
    expect(client.server).toMatchObject({ era: 'legacy', negotiation: 'fallback' });
    expect((await client.listTools()).tools).toHaveLength(2);
  }, 25_000);

  it('skips the probe for a server the host already knows is legacy', async () => {
    const legacy = legacyStatelessFallback(appServer);
    const { url, methods } = await serve(request => legacy(request));
    const client = await connectMcpClient({ url, knownLegacy: true });
    clients.push(client);
    expect(client.server?.era).toBe('legacy');
    expect(methods).not.toContain('server/discover');
  });

  it('never reads an authorization challenge as the server being legacy', async () => {
    const { url, methods } = await serve(async () => new Response(JSON.stringify({ error: 'invalid_token' }), {
      status: 401, headers: { 'content-type': 'application/json', 'www-authenticate': 'Bearer error="invalid_token"' },
    }));
    const failure = await connectMcpClient({ url }).catch(error => error);
    expect(await isMcpAuthenticationError(failure)).toBe(true);
    // One probe, no 2025 handshake retried behind it.
    expect(methods).toEqual(['server/discover']);
  });

  it('hears a 2026-07-28 tool-list change on its subscription stream', async () => {
    const handler = createMcpHandler(appServer);
    const { url, methods } = await serve(request => handler.fetch(request));
    const changed = vi.fn();
    const client = await connectMcpClient({ url, onToolsChanged: changed });
    clients.push(client);
    expect(methods).toContain('subscriptions/listen');
    await vi.waitFor(async () => { await handler.notify.toolsChanged(); expect(changed).toHaveBeenCalled(); }, { timeout: 5000 });
  });

  it('answers a 2026-07-28 multi-round-trip form with the host form handler', async () => {
    const handler = createMcpHandler(appServer);
    const { url } = await serve(request => handler.fetch(request));
    const onElicit = vi.fn(async () => ({ action: 'accept', content: { part: 'bolt' } }));
    const client = await connectMcpClient({
      url, onElicit,
      capabilities: { elicitation: { form: {} }, extensions: { 'openai/elicitation': { form: {} } } },
    });
    clients.push(client);
    const origin = { chat: 'A' };
    const result = await client.callTool({ name: 'ask', arguments: {} }, { origin });
    expect(onElicit).toHaveBeenCalledWith({ method: 'elicitation/create', round: true, params: expect.objectContaining({
      mode: 'form', message: 'Choose a part',
      _meta: { 'openai/elicitation': { requestedSchema: { type: 'object', properties: { part: { type: 'string', 'x-openai-suggestions': [{ const: 'bolt', title: 'Bolt' }] } } } } },
    }) }, expect.any(AbortSignal), origin);
    expect(JSON.parse(text(result))).toEqual({ action: 'accept', content: { part: 'bolt' } });
  });

  it('answers each 2026-07-28 round for the call that asked, echoing the server state, even with calls running side by side', async () => {
    const handler = createMcpHandler(twoFormServer);
    const { url } = await serve(request => handler.fetch(request));
    const seen: { message: unknown; origin: unknown }[] = [];
    const client = await connectMcpClient({ url, capabilities: { elicitation: { form: {} } },
      onElicit: async (request, _signal, origin) => {
        seen.push({ message: request.params.message, origin });
        const who = (origin as { chat: string }).chat;
        return { action: 'accept', content: request.params.message === 'First' ? { part: `bolt-${who}` } : { size: who === 'A' ? 6 : 8 } };
      } });
    clients.push(client);
    const [a, b] = await Promise.all([
      client.callTool({ name: 'askTwice', arguments: {} }, { origin: { chat: 'A' } }),
      client.callTool({ name: 'askTwice', arguments: {} }, { origin: { chat: 'B' } }),
    ]);
    expect(JSON.parse(text(a))).toEqual({ first: JSON.stringify({ part: 'bolt-A' }), second: { size: 6 } });
    expect(JSON.parse(text(b))).toEqual({ first: JSON.stringify({ part: 'bolt-B' }), second: { size: 8 } });
    expect(seen).toHaveLength(4);
    for (const entry of seen) expect(entry.origin).toEqual({ chat: expect.stringMatching(/^[AB]$/) });
  });

  it('fails a 2026-07-28 call plainly when its form cannot be shown, and never asks a handler that is absent', async () => {
    const handler = createMcpHandler(appServer);
    const { url } = await serve(request => handler.fetch(request));
    const refusing = await connectMcpClient({ url, capabilities: { elicitation: { form: {} } },
      onElicit: async () => { throw new McpFormError('Ri cannot show this form: "part" uses an input Ri does not support.', 'unsupported'); } });
    clients.push(refusing);
    const failure = await refusing.callTool({ name: 'ask', arguments: {} }).catch(error => error);
    expect(failure).toBeInstanceOf(IntegrationError);
    expect(failure).toMatchObject({ code: 'provider_error', message: expect.stringContaining('does not support') });
  });

  it('hands a 2025-era server\'s form to the call whose response stream carried it, and returns refusals as JSON-RPC errors', async () => {
    const { url } = await legacyFormServer();
    const seen: { message: unknown; origin: unknown }[] = [];
    const client = await connectMcpClient({ url, knownLegacy: true, capabilities: { elicitation: { form: {} }, extensions: { 'openai/elicitation': { form: {} } } },
      onElicit: async (request, _signal, origin) => {
        seen.push({ message: request.params.message, origin });
        if ((origin as { chat?: string } | undefined)?.chat === 'refuse') throw new McpFormError('Ri cannot show this form here.', 'unsupported');
        return { action: 'accept', content: { by: (origin as { chat: string }).chat } };
      } });
    clients.push(client);
    const [a, b] = await Promise.all([
      client.callTool({ name: 'ask', arguments: { tag: 'A' } }, { origin: { chat: 'A' } }),
      client.callTool({ name: 'ask', arguments: { tag: 'B' } }, { origin: { chat: 'B' } }),
    ]);
    expect(JSON.parse(text(a))).toEqual({ action: 'accept', content: { by: 'A' } });
    expect(JSON.parse(text(b))).toEqual({ action: 'accept', content: { by: 'B' } });
    expect(seen).toEqual(expect.arrayContaining([{ message: 'Form for A', origin: { chat: 'A' } }, { message: 'Form for B', origin: { chat: 'B' } }]));
    const refused = await client.callTool({ name: 'ask', arguments: { tag: 'C' } }, { origin: { chat: 'refuse' } });
    expect(JSON.parse(text(refused))).toEqual({ error: { code: -32602, message: 'Ri cannot show this form here.' } });
  });

  it('advertises MCP Apps views to every server, and form support only with a form handler', async () => {
    const seen: unknown[] = [];
    const handler = createMcpHandler(appServer);
    const { url } = await serve(async request => {
      const body = await request.clone().json().catch(() => ({})) as { method?: string; params?: { _meta?: Record<string, unknown> } };
      if (body.method === 'server/discover') seen.push(body.params?._meta?.['io.modelcontextprotocol/clientCapabilities']);
      return handler.fetch(request);
    });
    clients.push(await connectMcpClient({ url }));
    expect(seen[0]).toEqual({ extensions: { 'io.modelcontextprotocol/ui': { mimeTypes: ['text/html;profile=mcp-app'] } } });
  });

  it('rejects a repeated tool-list cursor instead of looping', async () => {
    let page = 0;
    const { url } = await serve(async request => {
      const message = await request.json().catch(() => ({})) as { id?: number; method?: string };
      const reply = (result: unknown) => Response.json({ jsonrpc: '2.0', id: message.id, result });
      if (message.method === 'initialize') return reply({ protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'cursor-loop', version: '1' } });
      if (message.method === 'tools/list') return reply({ tools: [{ name: `tool-${page++}`, inputSchema: { type: 'object' } }], nextCursor: 'again' });
      return new Response(null, { status: 202 });
    });
    const client = await connectMcpClient({ url, knownLegacy: true });
    clients.push(client);
    await expect(client.listTools()).rejects.toMatchObject({ code: 'provider_error', message: expect.stringContaining('repeated') });
  });
});

describe('connectMcpClient over stdio', () => {
  /** A local server process, built on the v2 SDK's dual-era stdio entry. */
  function stdioFixture() {
    const require = createRequire(import.meta.url);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-mcp-stdio-'));
    const file = path.join(dir, 'server.cjs');
    fs.writeFileSync(file, `
const { McpServer, fromJsonSchema, inputRequired } = require(${JSON.stringify(require.resolve('@modelcontextprotocol/server'))});
const { serveStdio } = require(${JSON.stringify(require.resolve('@modelcontextprotocol/server/stdio'))});
const passthrough = { '~standard': { version: 1, vendor: 'fixture', validate: value => ({ value }) } };
serveStdio(() => {
  const server = new McpServer({ name: 'stdio-fixture', version: '1' }, { capabilities: { tools: { listChanged: true } } });
  const object = fromJsonSchema({ type: 'object' });
  server.registerTool('change', { inputSchema: object }, async () => { await server.sendToolListChanged(); return { content: [] }; });
  server.registerTool('ask', { inputSchema: object }, async (_args, ctx) => {
    const answer = ctx.mcpReq.inputResponses && ctx.mcpReq.inputResponses.form;
    if (answer) return { content: [{ type: 'text', text: JSON.stringify(answer) }] };
    return inputRequired({ inputRequests: { form: inputRequired.elicit({ mode: 'form', message: 'Standard form', requestedSchema: { type: 'object', properties: { part: { type: 'string' } } } }) } });
  });
  server.registerTool('askOpenAI', { inputSchema: object }, async (_args, ctx) => {
    const result = await ctx.mcpReq.send({ method: 'openai/elicitation/create', params: { mode: 'form', message: 'OpenAI form', requestedSchema: { type: 'object', properties: { part: { type: 'string', format: 'uri', 'x-openai-input': { type: 'resource', options: [] } } } } } }, passthrough);
    return { content: [{ type: 'text', text: JSON.stringify(result) }] };
  });
  return server;
});
`);
    return { command: process.execPath, args: [file], cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }

  it('negotiates 2026-07-28 with a local server and answers its forms', async () => {
    const fixture = stdioFixture();
    try {
      const onElicit = vi.fn(async () => ({ action: 'accept', content: { part: 'bolt' } }));
      const client = await connectMcpClient({ ...fixture, negotiate: 'auto', onElicit, capabilities: { elicitation: { form: {} } } });
      clients.push(client);
      expect(client.server).toMatchObject({ era: 'modern', protocolVersion: '2026-07-28', negotiation: 'probe' });
      const result = await client.callTool({ name: 'ask', arguments: {} }, { origin: 'local-call' });
      // A 2026-07-28 round is answered inside the call, so the origin is exact over stdio too.
      expect(onElicit).toHaveBeenCalledWith({ method: 'elicitation/create', round: true, params: expect.objectContaining({ message: 'Standard form' }) }, expect.any(AbortSignal), 'local-call');
      expect(text(result)).toContain('bolt');
    } finally { fixture.cleanup(); }
  });

  it('answers 2025-era server requests, including OpenAI\'s openai/elicitation/create', async () => {
    const fixture = stdioFixture();
    try {
      const onElicit = vi.fn(async (request: { method: string }) => ({ action: 'accept', content: { part: request.method === 'openai/elicitation/create' ? 'file:///parts/bolt.stl' : 'bolt' } }));
      const changed = vi.fn();
      // A local server keeps the 2025 handshake by default: one process, no probe.
      const client = await connectMcpClient({ ...fixture, onElicit, onToolsChanged: changed, capabilities: { elicitation: { form: {} }, extensions: { 'openai/elicitation': { form: {} } } } });
      clients.push(client);
      expect(client.server).toMatchObject({ era: 'legacy', protocolVersion: '2025-11-25', negotiation: 'known-legacy' });
      // The legacy shim turns the server's multi-round-trip request into a real server-to-client request.
      expect((await client.callTool({ name: 'ask', arguments: {} }, { origin: 'only-call' })).content).toEqual([{ type: 'text', text: JSON.stringify({ action: 'accept', content: { part: 'bolt' } }) }]);
      const openai = await client.callTool({ name: 'askOpenAI', arguments: {} }, { origin: 'only-call' });
      // A stdio request has no tie to a call on the wire. With one call in flight, it can only be that call's.
      expect(onElicit).toHaveBeenLastCalledWith({ method: 'openai/elicitation/create', params: expect.objectContaining({ message: 'OpenAI form', requestedSchema: expect.objectContaining({ properties: { part: expect.objectContaining({ 'x-openai-input': { type: 'resource', options: [] } }) } }) }) }, expect.any(AbortSignal), 'only-call');
      expect(JSON.parse(text(openai))).toEqual({ action: 'accept', content: { part: 'file:///parts/bolt.stl' } });
      await client.callTool({ name: 'change', arguments: {} });
      await vi.waitFor(() => expect(changed).toHaveBeenCalled(), { timeout: 5000 });
    } finally { fixture.cleanup(); }
  });

  it('refuses a local server\'s form when two calls are in flight, since nothing on the wire says whose it is', async () => {
    const fixture = stdioFixture();
    try {
      const origins: unknown[] = [];
      const client = await connectMcpClient({ ...fixture, capabilities: { elicitation: { form: {} }, extensions: { 'openai/elicitation': { form: {} } } },
        onElicit: async (_request, _signal, origin) => {
          origins.push(origin);
          if (origin === undefined) throw new McpFormError('Ri could not tell which chat asked for this form, so it was not shown.', 'unrouted');
          return { action: 'accept', content: { part: 'bolt' } };
        } });
      clients.push(client);
      const results = await Promise.all([
        client.callTool({ name: 'askOpenAI', arguments: {} }, { origin: 'chat-A' }),
        client.callTool({ name: 'askOpenAI', arguments: {} }, { origin: 'chat-B' }),
      ]);
      expect(origins).toEqual([undefined, undefined]);
      for (const result of results) expect(text(result)).toContain('could not tell which chat');
    } finally { fixture.cleanup(); }
  });
});
