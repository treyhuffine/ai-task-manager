/**
 * Browser-only MCP server.
 *
 * A narrow slice of the orchestrator MCP that exposes ONLY the `browser_*`
 * actions, for execution (workspace) sessions that opted into the browser. It
 * runs the same gated `runAction` as the full orchestrator route, so nothing
 * new bypasses the action layer.
 *
 * An optional `?profile=<name>` locks every call to a fixed browsing identity:
 * the execution cannot switch to a different logged-in profile (e.g. the user's
 * default one). This is how a workspace confines its executions to an isolated
 * browsing profile. Built per-request so the forced profile can vary per call.
 *
 * Bearer auth is enforced globally by the proxy (this path is not public). The
 * session's signed credential names the calling chat, so the audit trail says
 * which chat drove the browser (mcp-caller.ts).
 *
 * URL: POST /api/orchestrator/browser/mcp[?profile=<name>]
 */

import { APP_NAME } from '@/constants/app';
import { browserActions } from '@/lib/orchestrator/browser-actions';
import { runAction } from '@/lib/orchestrator/dispatch';
import { mcpCallContext } from '@/lib/orchestrator/mcp-caller';
import type { Action } from '@/lib/orchestrator/types';
import { createMcpHandler } from 'mcp-handler';

const SERVER_INSTRUCTIONS = `${APP_NAME} browser: typed tools to read and act on web pages through the agent browser. Read a page (browser_read), then act on the refs it returns (browser_act). If a result carries a "blocked" login or challenge signal, hand back to the user instead of trying to log in.`;

function buildHandler(forcedProfile: string | null) {
  return createMcpHandler(
    (server) => {
      for (const action of browserActions as unknown as Action[]) {
        server.registerTool(
          action.name,
          {
            description: action.description,
            inputSchema: action.params,
          },
          async (input: Record<string, unknown>, extra) => {
            // Lock the browsing identity so an execution cannot switch profiles.
            const scoped = forcedProfile ? { ...input, profile: forcedProfile } : input;
            // The calling chat (from the session credential), for the audit trail.
            const envelope = await runAction(action.name, scoped, mcpCallContext(extra?.requestInfo?.headers));
            return {
              content: [{ type: 'text' as const, text: JSON.stringify(envelope, null, 2) }],
              isError: !envelope.ok,
            };
          },
        );
      }
    },
    {
      serverInfo: {
        name: `${APP_NAME.toLowerCase()}-browser`,
        version: '0.1.0',
      },
      instructions: SERVER_INSTRUCTIONS,
    },
    {
      basePath: '/api/orchestrator/browser',
      maxDuration: 120,
      verboseLogs: process.env.NODE_ENV !== 'production',
    },
  );
}

function handle(req: Request): Promise<Response> {
  const profile = new URL(req.url).searchParams.get('profile');
  return buildHandler(profile)(req);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
