import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { isMcpTransport, riMcpHandler, zodStandardSchema } from './http-server';

/** A client that talks to the handler in process: no socket, the real wire format. */
async function connect(handler: (request: Request) => Promise<Response>, mode: 'auto' | 'legacy', headers: Record<string, string> = {}) {
  const client = new Client({ name: 'http-server-test', version: '1' }, { versionNegotiation: { mode } });
  await client.connect(new StreamableHTTPClientTransport(new URL('http://ri.test/api/orchestrator/mcp'), {
    fetch: (url, init) => handler(new Request(url, init)), requestInit: { headers },
  }));
  return client;
}

describe('zodStandardSchema', () => {
  it('publishes the JSON Schema SDK 1.x published, and validates with zod defaults and transforms', () => {
    const shape = { title: z.string().min(1), limit: z.number().int().default(20), tags: z.array(z.string()).optional() };
    const schema = zodStandardSchema(shape);
    expect(schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' })).toEqual(zodToJsonSchema(z.object(shape), { strictUnions: true, pipeStrategy: 'input' }));
    expect(schema['~standard'].validate({ title: 'Plan' })).toEqual({ value: { title: 'Plan', limit: 20 } });
    expect(schema['~standard'].validate({ title: '' })).toMatchObject({ issues: [{ path: ['title'] }] });
  });

  it('keeps a parameterless tool as the bare object schema clients already cached', () => {
    expect(zodStandardSchema({})['~standard'].jsonSchema.input({ target: 'draft-2020-12' }))
      .toEqual({ type: 'object', properties: {}, $schema: 'http://json-schema.org/draft-07/schema#' });
  });
});

describe('riMcpHandler', () => {
  const handler = riMcpHandler(server => {
    server.registerTool('echo', { description: 'Echo the caller', inputSchema: { text: z.string() }, annotations: { readOnlyHint: true } }, async (args, context) => ({
      content: [{ type: 'text', text: JSON.stringify({ text: args.text, era: context.era, caller: context.headers?.get('x-caller') ?? null }) }],
    }));
    server.registerTool('ping', { description: 'No parameters' }, async () => ({ content: [{ type: 'text', text: 'pong' }] }));
  }, { name: 'ri-test', version: '1.0.0', instructions: 'Test server' });

  it.each(['auto', 'legacy'] as const)('serves the same tools and request headers on the %s protocol era', async (mode) => {
    const client = await connect(handler, mode, { 'x-caller': 'chat-1' });
    try {
      expect(client.getProtocolEra()).toBe(mode === 'auto' ? 'modern' : 'legacy');
      expect(client.getNegotiatedProtocolVersion()).toBe(mode === 'auto' ? '2026-07-28' : '2025-11-25');
      expect(client.getInstructions()).toBe('Test server');
      const { tools } = await client.listTools();
      expect(tools.map(tool => [tool.name, tool.annotations?.readOnlyHint])).toEqual([['echo', true], ['ping', undefined]]);
      const result = await client.callTool({ name: 'echo', arguments: { text: 'hi' } });
      expect(JSON.parse((result.content as { text: string }[])[0]!.text)).toEqual({ text: 'hi', era: mode === 'auto' ? 'modern' : 'legacy', caller: 'chat-1' });
      expect((await client.callTool({ name: 'ping', arguments: {} })).content).toEqual([{ type: 'text', text: 'pong' }]);
      await expect(client.callTool({ name: 'echo', arguments: { text: 7 } })).resolves.toMatchObject({ isError: true });
    } finally { await client.close(); }
  });

  it('answers MCP only at …/mcp', () => {
    expect(isMcpTransport('mcp')).toBe(true);
    for (const other of ['sse', 'message', 'anything', undefined]) expect(isMcpTransport(other)).toBe(false);
  });
});
