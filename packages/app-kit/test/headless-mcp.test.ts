import { it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { z } from 'zod/v4';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { McpServiceTransport } from '../src/mcp-service';
import { mcpSchema } from '../src/sdk';
import { staticFixture } from '@ri/app-kit/testing';
import type { InstalledArtifact, OwnedTransport } from '@ri/app-kit/runtime';

it('qualifies and invokes a tools-only MCP service without listing or reading resources', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-headless-mcp-'));
  const methods: string[] = [];
  const input = z.object({ limit: z.number().int().min(1) }).strict(), output = z.object({ records: z.array(z.string()) }).strict();
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk));
    const body = JSON.parse(Buffer.concat(chunks).toString() || '{}'); methods.push(body.method);
    const handler = createMcpHandler(() => {
      const mcp = new McpServer({ name: 'tools-only-fixture', version: '1' });
      mcp.registerTool('read_records', { inputSchema: mcpSchema(input), outputSchema: mcpSchema(output) }, async () => ({ content: [{ type: 'text', text: 'fixture' }], structuredContent: { records: ['synthetic'] } }));
      return mcp;
    });
    const headers = new Headers(); for (const [name, value] of Object.entries(req.headers)) if (typeof value === 'string') headers.set(name, value);
    const response = await handler.fetch(new Request(`http://127.0.0.1${req.url}`, { method: req.method, headers, ...(req.method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
    res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const artifact = staticFixture(path.join(root, 'package'));
    delete artifact.manifest.extensions['com.ri'].ui;
    artifact.contract.actions = [{ name: 'read_records', description: 'Read synthetic records', inputSchema: z.toJSONSchema(input), outputSchema: z.toJSONSchema(output), audience: ['agent'], effect: 'read', timeoutMs: 3000, retry: 'read_safe', errors: [], examples: [{ input: { limit: 1 }, output: { records: ['synthetic'] } }], visibility: 'model' }];
    const installed: InstalledArtifact = { ...artifact, instanceId: randomUUID(), dataDir: root, cacheDir: root, logsDir: root };
    const control: OwnedTransport = { generation: randomUUID(), pid: process.pid, request: async method => method === 'authorizePrincipal' ? { credential: 'x'.repeat(48) } : {}, onCapability() {}, onExit() {}, async stop() {} };
    const transport = new McpServiceTransport(control, installed, `http://127.0.0.1:${(server.address() as { port: number }).port}/mcp`, async () => ({ scopeRef: null, ticket: null }));
    await transport.qualify();
    const result = await transport.request('invoke', { action: 'read_records', input: { limit: 1 }, context: { invocationId: randomUUID(), principal: { kind: 'chat', id: 'fixture' }, deadline: Date.now() + 3000, grantRevision: 1 } });
    expect(result).toEqual({ records: ['synthetic'] });
    expect(methods).toContain('tools/call'); expect(methods).not.toContain('resources/list'); expect(methods).not.toContain('resources/read');
    // The host speaks MCP 2026-07-28 to a service that offers it: one discovery probe, no 2025 handshake.
    expect(methods).toContain('server/discover'); expect(methods).not.toContain('initialize');
  } finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); fs.rmSync(root, { recursive: true, force: true }); }
});
