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
 */
import { createMcpHandler } from 'mcp-handler';
import { serveMcp, type McpToolRegistrar } from '@connectors/engine/mcp';
import type { NextRequest } from 'next/server';
import { APP_NAME } from '@/constants/app';
import {
  getConnectorRuntime,
  getConnectorOwnerId,
  resolveWorkspaceConnectorFilter,
} from '@/lib/connectors/runtime';

const SERVER_INSTRUCTIONS = `${APP_NAME} connectors: typed tools for taking authenticated actions on the user's connected external accounts (Gmail, Calendar, Slack, Notion, Linear, and more).

Guidelines:
- One tool per action. Names are provider-namespaced (e.g. gmail__send_email, slack__post_message).
- When multiple accounts of a provider are connected, pass \`account\` (email/label) to choose one.
- A tool may return a structured next-step instead of a result: authorization_required (the user must connect that account), choose_account, additional_permission_required, or approval_required (a mutating action awaiting the user's OK). Relay it and retry after the user acts, never invent an auth flow.
- Mutating actions (send, create, delete) pass through the user's approval gate.`;

/** Build a per-request MCP handler scoped by the optional `?ws` workspace id. */
function buildHandler(workspaceId: string | null) {
  return createMcpHandler(
    async (server) => {
      const ownerId = getConnectorOwnerId();
      const runtime = await getConnectorRuntime();

      let toolkits: string[];
      let connectionPins: Record<string, string> | undefined;
      if (workspaceId) {
        // Execution surface: only the workspace's allowlist (scoped ∩ connected), with account
        // pins resolved + validated server-side (fail-closed). Derived from the validated id.
        const filter = await resolveWorkspaceConnectorFilter(workspaceId, ownerId);
        toolkits = filter.toolkits;
        connectionPins = filter.connectionPins;
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
        caller: { type: 'mcp' },
        toolkits,
        ...(connectionPins && Object.keys(connectionPins).length > 0 ? { connectionPins } : {}),
        onPause: (actionId, outcome) => {
          // The approval pending (if any) is registered inside the ApprovalPolicy; trace the pause.
          if (!outcome.ok) console.log(`[connectors-mcp] ${actionId} → ${outcome.reason}`);
        },
      });
    },
    {
      serverInfo: { name: `${APP_NAME.toLowerCase()}-connectors`, version: '0.1.0' },
      instructions: SERVER_INSTRUCTIONS,
    },
    {
      basePath: '/api/connectors',
      maxDuration: 120,
      verboseLogs: process.env.NODE_ENV !== 'production',
    },
  );
}

function handle(req: NextRequest): Promise<Response> {
  const ws = new URL(req.url).searchParams.get('ws');
  return buildHandler(ws)(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
