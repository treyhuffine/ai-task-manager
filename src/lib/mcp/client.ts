/**
 * Adapter: connect to the local MCP server over Streamable HTTP and expose
 * the `query` and `update` tools as AI SDK ToolSet so they can be passed
 * directly to `streamText`. Used by the in-app playground route.
 *
 * Note: AI SDK v6 removed its built-in MCP client helper, so we wire the MCP
 * client directly. It speaks 2026-07-28 to Ri's own server (which serves both eras).
 */

import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { tool, jsonSchema, type ToolSet } from 'ai';
import { APP_SHORT_ID } from '@/constants/app';

export interface RiMcpClient {
  tools: ToolSet;
  close: () => Promise<void>;
}

export async function createRiMcpClient(
  baseUrl: string,
  token: string,
): Promise<RiMcpClient> {
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`), {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
    },
  });

  const client = new Client({ name: `${APP_SHORT_ID}-playground`, version: '0.1.0' }, { versionNegotiation: { mode: 'auto' } });
  await client.connect(transport);

  const listed = await client.listTools();
  const tools: ToolSet = {};

  for (const t of listed.tools) {
    tools[t.name] = tool({
      description: t.description ?? '',
      inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
      execute: async (input: unknown) => {
        const result = await client.callTool({
          name: t.name,
          arguments: (input ?? {}) as Record<string, unknown>,
        });

        const content = (result.content ?? []) as Array<{ type: string; text?: string }>;
        const text = content
          .filter((c) => c.type === 'text' && typeof c.text === 'string')
          .map((c) => c.text as string)
          .join('\n');

        return text;
      },
    });
  }

  return {
    tools,
    close: async () => {
      try {
        await client.close();
      } catch (err) {
        console.error('[ri-mcp-client] close failed', err);
      }
    },
  };
}
