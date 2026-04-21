/**
 * MCP Playground chat route.
 *
 * The outer agent runs here. It's connected to the local MCP server
 * (same app) via a streamable-HTTP MCP client, so its only tools are
 * `query` and `update`. The inner tool loop that fulfils those calls lives
 * on the MCP side (src/lib/mcp/agent.ts).
 *
 * This is intentionally dogfooding the public MCP surface — we observe it
 * from both sides and surface everything in the UI.
 */

import { streamText, stepCountIs, convertToModelMessages, type UIMessage } from 'ai';
import { openai } from '@ai-sdk/openai';
import { anthropic } from '@ai-sdk/anthropic';
import { createFlowMcpClient } from '@/lib/mcp/client';
import { readAuthConfig } from '@/lib/auth/config-file';
import { getRunningPort } from '@/lib/auth/port';
export const maxDuration = 120;

const SYSTEM_PROMPT = `You are a helpful assistant.`;

function pickModel(id: string) {
  if (id.startsWith('claude')) return anthropic(id);
  return openai(id);
}

export async function POST(req: Request) {
  const body = (await req.json()) as {
    messages: UIMessage[];
    model?: string;
  };

  const modelId = body.model ?? 'gpt-5.4-mini';

  const token = readAuthConfig()?.localToken;
  if (!token) {
    return Response.json(
      { error: 'No local token found. Run `pnpm auth:pair` first.' },
      { status: 500 },
    );
  }

  const port = getRunningPort();
  const baseUrl = `http://localhost:${port}`;

  let mcp: Awaited<ReturnType<typeof createFlowMcpClient>>;
  try {
    mcp = await createFlowMcpClient(baseUrl, token);
  } catch (err) {
    console.error('[playground] failed to connect to MCP server', err);
    return Response.json({ error: 'Failed to connect to MCP server.' }, { status: 502 });
  }

  const result = streamText({
    model: pickModel(modelId),
    system: SYSTEM_PROMPT,
    messages: await convertToModelMessages(body.messages),
    tools: mcp.tools,
    stopWhen: stepCountIs(8),
    onFinish: () => {
      void mcp.close();
    },
  });

  return result.toUIMessageStreamResponse();
}
