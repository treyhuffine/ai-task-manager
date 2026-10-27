import { registerActionTool } from '@/lib/orchestrator/mcp-registration';
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

/**
 * What an outside agent connected with its own key (Settings → Connect your
 * agent) is told when it connects: the essentials of Ri's skill
 * (`skills/orchestrator/SKILL.md`), so an agent on another computer works
 * well without installing it.
 */
function contentInstructions(): string {
  return `${APP_NAME} content tools: search, read and update the user's tasks, notes, areas and priority deck.

- Search before creating, so you never add a duplicate. IDs are UUIDs: look them up with list_* or search, never pass a name.
- Something to do is a task, with an imperative title ("Ship the new MCP"). Pure capture (an idea, a link, a reference) is a note.
- New tasks start in todo. Use consider only for a tentative possibility. Change status with transition_task and finish with complete_task. update_task changes content and metadata only.
- Read before writing. When you edit a body, pass its current revision so newer text is never replaced.
- A decision is a note with kind "decision", titled with what was decided.
- There is no delete. Archive instead.

These tools act directly on the user's ${APP_NAME}. They do not start ${APP_NAME} chats or run commands, and they can't reach the private capture stream, chats, files or settings.

Today's date: ${new Date().toISOString().slice(0, 10)}.`;
}

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
        registerActionTool(
          server, action,
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
          contentOnly ? { params: action.localContract?.params ?? action.params, description: action.name === 'search' ? 'Search the tasks and notes in this Ri by meaning or keyword.' : action.localContract?.description ?? action.description } : undefined,
        );
      }
    },
    {
      name: `${APP_NAME.toLowerCase()}-orchestrator`,
      version: '0.1.0',
      instructions: contentOnly ? contentInstructions() : SERVER_INSTRUCTIONS,
    },
  );
  return handler(request);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
