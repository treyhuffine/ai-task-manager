/**
 * Connectors MCP server — projects the connector engine's actions (Gmail, Slack, …) as typed MCP
 * tools for an in-repo agent harness (Claude Code, Codex). Mirrors the orchestrator MCP route
 * (`/api/orchestrator/[transport]`): `createMcpHandler` + the engine's `serveMcp`, which registers
 * one tool per action over the SAME gated `runAction` — so the harness passes the identical trust
 * spine (scope, approval, redaction, audit) as every other caller.
 *
 * Bearer auth is enforced globally by the middleware; the harness attaches this with the app's
 * localToken (see `connectorsMcpServer` in orchestrator/harness-surface.ts).
 *
 * URLs:  POST /api/connectors/mcp  (Streamable HTTP) · GET /api/connectors/sse (legacy)
 * Static siblings (connect, run, status, …) take routing precedence; this catches mcp/sse.
 *
 * Scoping: an optional `?ws=<workspaceId>` narrows the tool set to that workspace's connector
 * allowlist (executions); omitted = the broad connected set (orchestrator/content). The handler is
 * built PER REQUEST so it can read `?ws` (mcp-handler's init callback has no request access). The
 * filter is always derived server-side from the validated workspace — never a client-asserted scope.
 *
 * Caller identity: a harness session at home carries its signed session credential (the same
 * header the orchestrator MCP reads), and a session on another computer speaks with its own session
 * token, which the proxy verifies. Either stamps the call as coming from that chat, so
 * an action paused on "Ask first" surfaces as an approval card in exactly that transcript, and the
 * grant the user gives matches only that chat's retry. Unverified or absent → an anonymous MCP call,
 * still fully gated.
 */
import { createMcpHandler } from 'mcp-handler';
import { serveMcp, type McpToolRegistrar } from '@connectors/engine/mcp';
import type { AccountChoice } from '@connectors/engine';
import type { NextRequest } from 'next/server';
import { APP_NAME } from '@/constants/app';
import {
  getConnectorRuntime,
  getConnectorOwnerId,
  resolveWorkspaceConnectorFilter,
} from '@/lib/connectors/runtime';
import { sessionCaller } from '@/lib/connectors/approval';
import { actorFromSessionCredential, sessionCredentialFromHeaders } from '@/lib/orchestrator/session-credential';
import { getRequestKey } from '@/lib/auth/request-key';
import { connectedButUnavailable, recordPausedConnection, requestConnection } from '@/lib/connectors/connection-requests';
import { connectorRequestsEnabled } from '@/lib/connectors/request-settings';
import { z } from 'zod';

/** The slice of the SDK server this route registers its own tool through. */
interface ConnectionToolRegistrar {
  registerTool(
    name: string,
    config: { description: string; inputSchema: z.ZodRawShape },
    handler: (args: Record<string, unknown>) => Promise<{ content: { type: 'text'; text: string }[] }>,
  ): void;
}

/**
 * When to ask for a connection, stated once for the tool and once for the server's instructions.
 * The whole judgment the agent makes: need + no tools + no substitute (docs/connecting-from-chat.md).
 */
const REQUEST_CONNECTION_RULE = `Ask the user to connect an outside service (or give you access to one) when their current request needs it and you have no tools for it. Call it only when all three hold: (1) finishing the user's current request needs data or an action in a specific outside service, named or clearly implied ("my inbox", "tomorrow's meetings", "the Linear ticket"); (2) you have no tools for that service; (3) nothing you already have covers it. Never for ${APP_NAME}'s own tasks, notes, deck or stream, never for content the user pasted, and never just to suggest a connection. Name the service the user named, in plain words ("Gmail", "Google Calendar", "Slack"), one call per service. If they named an account ("my Market Standard email", trey@example.com), pass it as account. Don't guess a provider: if they only said something generic ("my email", "my calendar") and more than one service could be it (Gmail or Outlook, Google Calendar or Outlook Calendar), ask them which one they use before calling. The app works out what the name means, shows the user a Connect card in this chat, and sends you a note when they decide. ${APP_NAME} can connect Google (Gmail, Calendar, Drive, Docs, Sheets), Microsoft 365 (Outlook Mail and Calendar), Slack, Notion, Linear, Jira, Todoist and about 25 more.`;

function serverInstructions(requestsOn: boolean): string {
  return `${APP_NAME} connectors: typed tools for taking authenticated actions on the user's connected external accounts (Gmail, Calendar, Slack, Notion, Linear, and more).

Guidelines:
- One tool per action. Names are provider-namespaced (e.g. gmail__send_email, slack__post_message).
- When multiple accounts of a provider are connected, pass \`account\` (email/label) to choose one.
- A tool may return a structured next-step instead of a result: authorization_required or additional_permission_required (the user gets a card in your chat to reconnect or grant access), choose_account, or approval_required (a mutating action awaiting the user's OK). For a card: tell the user briefly, then stop and wait. A note arrives when they're done, and then you retry. Never invent an auth flow.
- Mutating actions (send, create, delete) pass through the user's approval gate. On approval_required the user gets an approval card in your chat: stop and wait. A note arrives when they decide, naming which calls to retry and which not to. Only the user can approve.${
    requestsOn ? `\n- request_connection: ${REQUEST_CONNECTION_RULE}` : ''
  }`;
}

/** Build a per-request MCP handler scoped by the optional `?ws` workspace id and calling chat. */
function buildHandler(workspaceId: string | null, sessionId: string | null) {
  // Asking for a connection needs a chat to put the card in, and the user's say-so (Settings).
  const requestsOn = sessionId !== null && connectorRequestsEnabled();
  return createMcpHandler(
    async (server) => {
      const ownerId = getConnectorOwnerId();
      const runtime = await getConnectorRuntime();

      let toolkits: string[];
      let connectionPins: Record<string, string> | undefined;
      let allowedAccounts: Record<string, AccountChoice[]> | undefined;
      if (workspaceId) {
        // Execution surface: only the workspace's allowlist (scoped ∩ connected), with account
        // pins and account sets resolved + validated server-side (fail-closed). Derived from the
        // validated id.
        const filter = await resolveWorkspaceConnectorFilter(workspaceId, ownerId);
        toolkits = filter.toolkits;
        connectionPins = filter.connectionPins;
        allowedAccounts = filter.allowedAccounts;
      } else {
        // Broad surface (orchestrator/content): every connected provider's toolkits. mcp-handler
        // builds a fresh server per POST, so newly-connected accounts / MCP servers appear without
        // a restart — the only lag is an already-running session caching its tool list.
        const connections = await runtime.listConnections({ ownerId });
        const connected = new Set(connections.map((c) => c.providerId));
        toolkits = runtime
          .getToolkits()
          .filter((t) => connected.has(t.providerId))
          .map((t) => t.id);
      }

      // The SDK's McpServer has a more generic registerTool than the engine's structural
      // McpToolRegistrar; runtime-compatible, so bridge the two type defs.
      serveMcp(server as unknown as McpToolRegistrar, runtime, {
        ownerId,
        caller: sessionId ? sessionCaller(sessionId) : { type: 'mcp' },
        toolkits,
        ...(connectionPins && Object.keys(connectionPins).length > 0 ? { connectionPins } : {}),
        ...(allowedAccounts && Object.keys(allowedAccounts).length > 0 ? { allowedAccounts } : {}),
        onPause: (actionId, outcome) => {
          // The approval pending (if any) is registered inside the ApprovalPolicy; trace the pause.
          if (outcome.ok) return;
          console.log(`[connectors-mcp] ${actionId} → ${outcome.reason}`);
          // A connection that stopped working or needs more access: a Reconnect card in this chat.
          if (outcome.reason === 'auth_required' || outcome.reason === 'needs_consent') {
            void recordPausedConnection({ sessionId, scopeWorkspaceId: workspaceId, outcome }).catch((err) =>
              console.warn('[connectors-mcp] recording the reconnect card failed:', err),
            );
          }
        },
      });

      if (requestsOn) {
        // An agent with scoped access can't see what else is connected: name it, so it knows
        // there's something to ask for ("the Team Calendar" is a service, not a vague calendar).
        const others = workspaceId ? (await connectedButUnavailable(workspaceId)).slice(0, 25) : [];
        const description = others.length
          ? `${REQUEST_CONNECTION_RULE} Connected to ${APP_NAME} but not available to you yet (ask for access by name when a task needs one): ${others.join(', ')}.`
          : REQUEST_CONNECTION_RULE;
        (server as unknown as ConnectionToolRegistrar).registerTool(
          'request_connection',
          {
            description,
            inputSchema: {
              service: z.string().min(1).describe('The service in plain words: "Gmail", "Google Calendar", "Slack", "Linear".'),
              reason: z
                .string()
                .min(1)
                .max(300)
                .describe("One short sentence the user will see: what it's for, e.g. \"to read tomorrow's meetings\"."),
              for_agent: z
                .string()
                .optional()
                .describe('Only when the user asked for another agent to get access: that agent\'s name. Omit for yourself.'),
              user_asked: z
                .boolean()
                .optional()
                .describe('True only when the user explicitly asked, in their latest message, to connect this service.'),
              account: z
                .string()
                .optional()
                .describe('The account the user named, in their words: an email ("trey@example.com") or a name ("Market Standard"). Omit when they named none.'),
            },
          },
          async (args) => {
            const result = await requestConnection({
              sessionId,
              scopeWorkspaceId: workspaceId,
              service: String(args.service ?? ''),
              reason: String(args.reason ?? ''),
              forAgent: typeof args.for_agent === 'string' ? args.for_agent : null,
              userAsked: args.user_asked === true,
              account: typeof args.account === 'string' ? args.account : null,
            });
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          },
        );
      }
    },
    {
      serverInfo: { name: `${APP_NAME.toLowerCase()}-connectors`, version: '0.1.0' },
      instructions: serverInstructions(requestsOn),
    },
    {
      basePath: '/api/connectors',
      maxDuration: 120,
      verboseLogs: process.env.NODE_ENV !== 'production',
    },
  );
}

/**
 * Which chat is calling. A session on another computer is the chat its token names, as the proxy
 * verified it (P2.7). A session at home is the chat its signed credential names. Neither: none.
 */
function callingChat(req: NextRequest): string | null {
  const key = getRequestKey(req.headers);
  if (key?.scope === 'session') return key.sessionChatId;
  return actorFromSessionCredential(sessionCredentialFromHeaders(req.headers))?.sessionId ?? null;
}

function handle(req: NextRequest): Promise<Response> {
  const ws = new URL(req.url).searchParams.get('ws');
  return buildHandler(ws, callingChat(req))(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
