/**
 * Orchestrator MCP server.
 *
 * Distinct from the external user-facing MCP at `/api/[transport]` — that one
 * is a thin two-tool natural-language interface for remote agents. This one
 * is fine-grained and typed: one MCP tool per action in the orchestrator
 * registry, auto-generated. Built for in-repo agents (Claude Code, Codex, etc.)
 * doing direct CRUD work on the user's brain.
 *
 * Bearer auth is enforced globally by `src/middleware.ts`.
 *
 * URLs:
 *   POST /api/orchestrator/mcp   — Streamable HTTP
 *   GET  /api/orchestrator/sse   — SSE (legacy)
 */

import { createMcpHandler } from 'mcp-handler';
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
const staleCall = await handleUndiscoveredResultCall(request);
if (staleCall) return staleCall;
const visibleResultNames = new Set<string>(discoverableResultActions().map((action) => action.name));
const resultNames = new Set<string>(resultActions.map((action) => action.name));
const handler = createMcpHandler(
  (server) => {
    for (const action of actions) {
      if (resultNames.has(action.name) && !visibleResultNames.has(action.name)) continue;
      server.registerTool(
        action.name,
        {
          description: action.description,
          inputSchema: action.params,
        },
        async (input: Record<string, unknown>, extra) => {
          // Which chat and which key called, as the proxy validated them. The
          // home's own sessions use the home's own key, so their folder paths
          // are the home's (mcp-caller.ts).
          const envelope = await runAction(action.name, input, mcpCallContext(extra?.requestInfo?.headers, { allowMissing: ['report_result', 'report_result_review'].includes(action.name) }));
          return {
            content: [{ type: 'text', text: JSON.stringify(envelope, null, 2) }],
            isError: !envelope.ok,
          };
        },
      );
    }
  },
  {
    serverInfo: {
      name: `${APP_NAME.toLowerCase()}-orchestrator`,
      version: '0.1.0',
    },
    instructions: SERVER_INSTRUCTIONS,
  },
  {
    basePath: '/api/orchestrator',
    maxDuration: 120,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
);
return handler(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
