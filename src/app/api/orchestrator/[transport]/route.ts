/**
 * Orchestrator MCP server.
 *
 * Distinct from the external user-facing MCP at `/api/[transport]` — that one
 * is a thin two-tool natural-language interface for remote agents. This one
 * is fine-grained and typed: one MCP tool per action in the orchestrator
 * registry, auto-generated. Built for in-repo agents (Claude Code, Codex, etc.)
 * doing direct CRUD work on the user's brain.
 *
 * Bearer auth is enforced globally by `src/proxy.ts`.
 *
 * URL: POST /api/orchestrator/mcp, Streamable HTTP. Serves MCP 2026-07-28 and 2025-era clients
 * from one handler (src/lib/mcp/http-server.ts). The HTTP+SSE transport is retired.
 */

import { z } from 'zod';
import { isMcpTransport, mcpNotFound, riMcpHandler } from '@/lib/mcp/http-server';
import { getRequestKey } from '@/lib/auth/request-key';
import { permitsHomeContentAction } from '@/lib/external-ai/policy';
import { APP_NAME } from '@/constants/app';
import { actions } from '@/lib/orchestrator/registry';
import { runAction } from '@/lib/orchestrator/dispatch';
import { mcpCallContext } from '@/lib/orchestrator/mcp-caller';
import { discoverableResultActions, resultActions, handleUndiscoveredResultCall } from '@/lib/orchestrator/result-actions';

const SERVER_INSTRUCTIONS = `${APP_NAME} orchestrator: typed, fine-grained tools for reading and writing the user's productivity brain.

Unlike the external MCP (which takes natural language), every tool here has a strict parameter schema and a predictable return shape. Use it when you need deterministic CRUD: listing tasks, creating notes, updating statuses, etc.

Guidelines:
- Read before writing. Start with list_* / get_* / describe_schema to ground yourself.
- Mutations go through the same invariants as the web app (embeddings, markdown mirror, attachment derivation). You don't need to manage those.
- describe_paths tells you where the data lives on disk.
- Call describe_schema once at session start if you need exact column names to plan a sequence of calls.

Today's date: ${new Date().toISOString().slice(0, 10)}.`;

async function handle(request: Request) {
  if (!isMcpTransport(new URL(request.url).pathname.split('/').pop())) return mcpNotFound();
  const contentOnly = getRequestKey(request.headers)?.scope === 'ai_client';
  const staleCall = contentOnly ? null : await handleUndiscoveredResultCall(request);
  if (staleCall) return staleCall;
  const visibleResultNames = new Set<string>(discoverableResultActions().map((action) => action.name));
  const resultNames = new Set<string>(resultActions.map((action) => action.name));
  const handler = riMcpHandler(
    (server) => {
      for (const action of actions) {
        if (contentOnly && !permitsHomeContentAction(action.name)) continue;
        if (resultNames.has(action.name) && !visibleResultNames.has(action.name)) continue;
        server.registerTool(
          action.name,
          {
            description: contentOnly && action.name === 'search' ? 'Search this Home’s tasks and notes by meaning or keyword.' : action.description,
            inputSchema: action.strictParams ? z.object(action.params).strict() : action.params,
          },
          async (input, { headers }) => {
            // Which chat and which key called, as the proxy validated them. The
            // home's own sessions use the home's own key, so their folder paths
            // are the home's (mcp-caller.ts).
            const envelope = await runAction(action.name, input, mcpCallContext(headers, { allowMissing: ['report_result', 'report_result_review'].includes(action.name) }));
            return {
              content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
              isError: !envelope.ok,
            };
          },
        );
      }
    },
    {
      name: `${APP_NAME.toLowerCase()}-orchestrator`,
      version: '0.1.0',
      instructions: contentOnly ? 'Ri Home content tools: search, read and update tasks, notes, areas and the priority deck. Read before writing and use the current body revision when editing. These tools act directly on your Home. They do not start Ri chats or run commands. No access to the private capture stream, chats, files or settings.' : SERVER_INSTRUCTIONS,
    },
  );
  return handler(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
