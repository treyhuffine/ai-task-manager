/**
 * MCP server.
 *
 * Exposes two tools — `query` and `update` — that each take a natural-language
 * `message` plus optional `context`, and return a structured
 * `{ response, entities, innerSteps }` payload. External agents hit this to
 * read from or contribute to the user's productivity system; the app-side
 * agent routes the request via the same tools the in-app chat uses.
 *
 * Bearer auth is enforced globally by `src/middleware.ts`.
 *
 * URLs:
 *   POST /api/mcp   — Streamable HTTP (recommended)
 *   GET  /api/sse   — SSE (legacy)
 */

import { createMcpHandler } from 'mcp-handler';
import { z } from 'zod';
import { runMcpAgent } from '@/lib/mcp/agent';
import { APP_NAME } from '@/constants/app';

const SERVER_INSTRUCTIONS = `${APP_NAME} is the user's productivity source of truth — an AI-native workspace holding tasks, notes, areas (life/work domains), a daily priority deck, a semantic knowledge base, and their current-state context (active focus, energy, available time). Humans and agents share this workspace; it stays consistent across both.

The server interprets natural-language messages against the full state, with knowledge of the user's conventions, history, and preferences.

Two tools are available (see their descriptions). Both take a \`message\` and an optional \`context\`. Responses return a natural-language \`response\`, any \`entities\` touched or referenced, and \`innerSteps\` showing what the server did internally.

Today's date: ${new Date().toISOString().slice(0, 10)}.`;

const MESSAGE_DESCRIPTION =
  `Natural-language information for the server to interpret — a question, statement, observation, intent, or reference. If you're passing along a user message, you can send it as-is; use the \`context\` field to enhance the server's ability to reason about it.`;

const CONTEXT_DESCRIPTION =
  `Optional additional context you have available — conversation messages, decisions made in the session, workspace or folder you're in, contents of relevant files, outputs from recent work, results from prior calls to these tools, user preferences or constraints you've observed, anything else relevant. Only include information you actually have — it's fine to leave this empty or sparse, and don't fabricate or feel obligated to fill every category. If you're in a multi-turn conversation with the user, include recent messages in \`context\` with clear structure — marking which are user messages and which are AI responses. Don't hallucinate a conversation: if you've only received one user message, that message goes in \`message\` and you don't need to include conversation context. The server is intelligent and will decide which tools to call and what information to return based on this context and its own knowledge of the user's data.`;

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'query',
      {
        description: `Read-only mode — surface information from the user's productivity system (tasks, notes, areas, deck, knowledge base, current state). The server never modifies state in this mode, regardless of what the message says. Returns { response, entities, innerSteps }.`,
        inputSchema: {
          message: z.string().describe(MESSAGE_DESCRIPTION),
          context: z.string().optional().describe(CONTEXT_DESCRIPTION),
        },
      },
      async ({ message, context }) => {
        try {
          const payload = await runMcpAgent(message, 'query', context);
          return {
            content: [{ type: 'text', text: JSON.stringify(payload) }],
          };
        } catch (err) {
          console.error('[mcp:query]', err);
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ response: 'Internal error — see server logs.', entities: [] }) }],
          };
        }
      },
    );

    server.registerTool(
      'update',
      {
        description: `Write-capable mode — share information that may result in state changes (new work, completions, status changes, observations, references). The server interprets and decides what to do. Returns { response, entities, innerSteps } with real IDs.`,
        inputSchema: {
          message: z.string().describe(MESSAGE_DESCRIPTION),
          context: z.string().optional().describe(CONTEXT_DESCRIPTION),
        },
      },
      async ({ message, context }) => {
        try {
          const payload = await runMcpAgent(message, 'update', context);
          return {
            content: [{ type: 'text', text: JSON.stringify(payload) }],
          };
        } catch (err) {
          console.error('[mcp:update]', err);
          return {
            isError: true,
            content: [{ type: 'text', text: JSON.stringify({ response: 'Internal error — see server logs.', entities: [] }) }],
          };
        }
      },
    );
  },
  {
    serverInfo: {
      name: APP_NAME.toLowerCase(),
      version: '0.1.0',
    },
    instructions: SERVER_INSTRUCTIONS,
  },
  {
    basePath: '/api',
    maxDuration: 800,
    verboseLogs: process.env.NODE_ENV !== 'production',
  },
);

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
