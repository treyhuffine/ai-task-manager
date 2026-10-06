import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectMcpClient } from '@integrations/engine/mcp';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { mcpAuthHeaders } from './runtime';

vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));

const endpoint = 'https://mcp.monday.com/mcp';
const helpUrl = 'https://developer.monday.com/api-reference/docs/mcp-api-token';

afterEach(() => { vi.unstubAllGlobals(); });

describe('monday.com personal hosted MCP profile', () => {
  it('uses the documented personal bearer flow, official transport and high mutation floor', () => {
    expect(getHostedMcpProvider('monday')).toMatchObject({
      url: endpoint, defaultMutationRisk: 'high',
      auth: { kind: 'bearer', label: 'Personal API token', helpUrl },
    });
  });

  it('sends the personal token through the real MCP transport without OAuth or query credentials', async () => {
    const methods: string[] = [];
    const token = 'synthetic-monday-personal-token';
    // These tools and account-free results are synthetic protocol fixtures,
    // not claims about monday's authenticated tool schema or response shape.
    const tool = { name: 'fixture_read_boards', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } };
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(endpoint);
      expect(request.headers.get('Authorization')).toBe(`Bearer ${token}`);
      expect(request.headers.has('Api-Version')).toBe(false);
      if (request.method === 'GET') return new Response(null, { status: 405 });
      expect(request.method).toBe('POST');
      const message = await request.json() as { id?: number; method: string };
      methods.push(message.method);
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'monday-fixture', version: '1' } }
        : message.method === 'tools/list' ? { tools: [tool] }
          : message.method === 'tools/call' ? { content: [{ type: 'text', text: 'Synthetic response' }] }
            : undefined;
      if (!result) throw new Error(`Unexpected MCP fixture method ${message.method}`);
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    });
    vi.stubGlobal('fetch', fetchFixture);

    const client = await connectMcpClient({ url: endpoint, headers: mcpAuthHeaders({ kind: 'bearer' }, token) });
    try {
      expect(await client.listTools()).toEqual({ tools: [tool] });
      expect(await client.callTool({ name: tool.name })).toMatchObject({ content: [{ type: 'text', text: 'Synthetic response' }], isError: false });
      expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    } finally {
      await client.close();
    }
  });

  it('does not dynamically register an OAuth client when a personal token is rejected', async () => {
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(endpoint);
      expect(request.method).toBe('POST');
      expect(request.headers.get('Authorization')).toBe('Bearer synthetic-rejected-token');
      return new Response('Unauthorized', { status: 401, headers: {
        'WWW-Authenticate': 'Bearer resource_metadata="https://mcp.monday.com/.well-known/oauth-protected-resource/mcp"',
      } });
    });
    vi.stubGlobal('fetch', fetchFixture);
    await expect(connectMcpClient({
      url: endpoint, headers: mcpAuthHeaders({ kind: 'bearer' }, 'synthetic-rejected-token'),
    })).rejects.toMatchObject({ code: 401 });
    expect(fetchFixture).toHaveBeenCalledOnce();
  });
});
