import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectMcpClient } from '@integrations/engine/mcp';
import { getHostedMcpProvider } from '@integrations/engine/providers';
import { mcpAuthHeaders } from './runtime';

vi.mock('@/lib/db/queries', () => ({ getWorkspace: vi.fn() }));

const endpoint = 'https://mcp.dataforseo.com/v3/mcp';
const token = Buffer.from('seo@example.com:synthetic-api-password').toString('base64');

afterEach(() => { vi.unstubAllGlobals(); });

describe('DataForSEO API credentials', () => {
  it('offers the API login and password beside browser sign-in', () => {
    expect(getHostedMcpProvider('dataforseo')).toMatchObject({
      url: endpoint, auth: { kind: 'oauth' },
      tokenAuth: { label: 'API login:password', helpUrl: 'https://app.dataforseo.com/api-access', scheme: 'basic' },
    });
  });

  it('keeps every other static key on Bearer', () => {
    expect(mcpAuthHeaders({ kind: 'bearer' }, 'key')).toEqual({ Authorization: 'Bearer key' });
    expect(mcpAuthHeaders({ kind: 'bearer' }, token, 'basic')).toEqual({ Authorization: `Basic ${token}` });
    expect(mcpAuthHeaders({ kind: 'bearer' }, null, 'basic')).toBeUndefined();
  });

  it('sends Basic credentials through the real MCP transport', async () => {
    const methods: string[] = [];
    // The server's documentation tool shape. The results are synthetic.
    const tool = { name: 'docs_list_sections', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } };
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(endpoint);
      expect(request.headers.get('Authorization')).toBe(`Basic ${token}`);
      if (request.method === 'GET') return new Response(null, { status: 405 });
      expect(request.method).toBe('POST');
      const message = await request.json() as { id?: number; method: string };
      methods.push(message.method);
      if (message.method === 'notifications/initialized') return new Response(null, { status: 202 });
      const result = message.method === 'initialize'
        ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'dataforseo-fixture', version: '1' } }
        : message.method === 'tools/list' ? { tools: [tool] }
          : message.method === 'tools/call' ? { content: [{ type: 'text', text: 'Synthetic sections' }] }
            : undefined;
      if (!result) throw new Error(`Unexpected MCP fixture method ${message.method}`);
      return Response.json({ jsonrpc: '2.0', id: message.id, result });
    });
    vi.stubGlobal('fetch', fetchFixture);

    const client = await connectMcpClient({ url: endpoint, headers: mcpAuthHeaders({ kind: 'bearer' }, token, 'basic') });
    try {
      expect(await client.listTools()).toEqual({ tools: [tool] });
      expect(await client.callTool({ name: tool.name })).toMatchObject({ content: [{ type: 'text', text: 'Synthetic sections' }], isError: false });
      expect(methods).toEqual(['initialize', 'notifications/initialized', 'tools/list', 'tools/call']);
    } finally {
      await client.close();
    }
  });

  it('does not fall back to OAuth registration when the credentials are rejected', async () => {
    const fetchFixture = vi.fn<typeof fetch>(async (input, init) => {
      const request = new Request(input, init);
      expect(request.url).toBe(endpoint);
      expect(request.headers.get('Authorization')).toBe(`Basic ${token}`);
      return new Response('Unauthorized', { status: 401, headers: {
        'WWW-Authenticate': 'Bearer error="invalid_token", resource_metadata="https://mcp.dataforseo.com/.well-known/oauth-protected-resource", scope="api"',
      } });
    });
    vi.stubGlobal('fetch', fetchFixture);
    await expect(connectMcpClient({ url: endpoint, headers: mcpAuthHeaders({ kind: 'bearer' }, token, 'basic') })).rejects.toMatchObject({ code: 401 });
    expect(fetchFixture).toHaveBeenCalledOnce();
  });
});
