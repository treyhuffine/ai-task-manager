import http from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { connectMcpClient, type ConnectedMcpClient } from '../mcp/client';

let client: ConnectedMcpClient | undefined;
let server: http.Server | undefined;
afterEach(async () => {
  await client?.close();
  if (server) {
    const closed = new Promise<void>(resolve => server!.close(() => resolve()));
    server.closeAllConnections();
    await closed;
  }
});

it('uses the real Node HTTP dispatcher for discovery, resources, tool responses and isolated cancellation', async () => {
  let held: http.ServerResponse | undefined;
  let heldClosed = false;
  server = http.createServer(async (req, res) => {
    if (req.method !== 'POST') { res.writeHead(405).end(); return; }
    expect(req.headers.authorization).toBe('Basic fixture');
    let body = '';
    for await (const chunk of req) body += chunk;
    const message = JSON.parse(body);
    const reply = (result: unknown) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    };
    switch (message.method) {
      case 'initialize':
        reply({ protocolVersion: message.params.protocolVersion, capabilities: { tools: {}, resources: {} }, serverInfo: { name: 'fixture', version: '1' } });
        break;
      case 'tools/list': reply({ tools: [{ name: 'research', inputSchema: { type: 'object' } }] }); break;
      case 'resources/read': reply({ contents: [{ uri: message.params.uri, text: 'resource' }] }); break;
      case 'tools/call':
        expect(message.params._meta.progressToken).toBeDefined();
        if (message.params.arguments?.hold) {
          held = res;
          res.on('close', () => { heldClosed = true; });
        } else reply({ content: [{ type: 'text', text: 'done' }], structuredContent: { done: true } });
        break;
      default: res.writeHead(202).end();
    }
  });
  await new Promise<void>(resolve => server!.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  client = await connectMcpClient({ url: `http://127.0.0.1:${port}/mcp`, headers: { Authorization: 'Basic fixture' } });
  expect(await client.listTools()).toMatchObject({ tools: [{ name: 'research' }] });
  expect(await client.readResource({ uri: 'ui://fixture' })).toMatchObject({ contents: [{ text: 'resource' }] });
  const controller = new AbortController();
  const slow = client.callTool({ name: 'research', arguments: { hold: true } }, { signal: controller.signal }).catch(error => error);
  await vi.waitFor(() => expect(held).toBeDefined());
  expect(await client.callTool({ name: 'research' })).toMatchObject({ structuredContent: { done: true } });
  controller.abort();
  expect(await slow).toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(heldClosed).toBe(true));
  expect(await client.callTool({ name: 'research' })).toMatchObject({ isError: false });
});
