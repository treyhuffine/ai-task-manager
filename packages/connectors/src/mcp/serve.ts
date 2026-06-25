/**
 * serveMcp (§11): project the runtime's actions as MCP tools for *external* hosts,
 * over the SAME `runAction` — so an outside agent passes the identical gates as app
 * code. Transport-agnostic: it registers tools onto any object with a
 * `registerTool` method (the `@modelcontextprotocol/sdk` `McpServer` satisfies this,
 * as does a test double). Like the AI-SDK projection, it injects `account`, hides the
 * opaque `connectionId`, and redacts results.
 */
import { z } from 'zod';
import { toToolName, projectedDescription, modelSafeOutcome, type FailedOutcome } from '../core/projection-shared';
import type { ActionOutcome, Caller, ConnectorRuntime, Redactor } from '../core/types';

export interface McpTextContent {
  type: 'text';
  text: string;
}

export interface McpToolResult {
  content: McpTextContent[];
  isError?: boolean;
}

/** The subset of `@modelcontextprotocol/sdk`'s `McpServer` that serveMcp needs. */
export interface McpToolRegistrar {
  registerTool(
    name: string,
    config: { description?: string; inputSchema?: Record<string, z.ZodTypeAny> },
    handler: (args: Record<string, unknown>) => Promise<McpToolResult>,
  ): void;
}

export interface ServeMcpOptions {
  ownerId?: string;
  toolkits?: string[];
  caller?: Caller;
  /** Host channel for pause/error outcomes — receives the full outcome (URL + ids). */
  onPause?: (actionId: string, outcome: ActionOutcome) => void;
  /** Shared redactor so tool results are scrubbed before leaving the process. */
  redactor?: Redactor;
  /**
   * Hard-pin a toolkit to one connection id, keyed by toolkit id. A pinned toolkit's tools run
   * against exactly that connection (no `account` choice exposed to the model) — used to enforce
   * a workspace's account scoping. Resolve the pin (account → live connection id) on the host.
   */
  connectionPins?: Record<string, string>;
}

export function serveMcp(server: McpToolRegistrar, runtime: ConnectorRuntime, options: ServeMcpOptions = {}): void {
  const caller: Caller = options.caller ?? { type: 'mcp' };
  const all = runtime.getToolkits();
  const selected = options.toolkits ? all.filter((t) => options.toolkits!.includes(t.id)) : all;

  for (const toolkit of selected) {
    // A pinned toolkit runs against exactly this connection — the account is fixed, so it's neither
    // exposed as a tool param nor honored from the model's args.
    const pin = options.connectionPins?.[toolkit.id];
    for (const a of toolkit.actions) {
      const shape = (a.input as unknown as z.ZodObject<z.ZodRawShape>).shape;
      server.registerTool(
        toToolName(a.id),
        {
          description: projectedDescription(a),
          inputSchema: {
            ...shape,
            ...(pin
              ? {}
              : { account: z.string().optional().describe('Which connected account (email/label) to act as; omit if only one.') }),
          },
        },
        async (args) => {
          const { account, ...rest } = args as { account?: string } & Record<string, unknown>;
          const outcome = await runtime.runAction(a.id, rest, {
            ...(options.ownerId ? { ownerId: options.ownerId } : {}),
            ...(pin ? { connectionId: pin } : account ? { account } : {}),
            caller,
          });
          if (outcome.ok) {
            const result = options.redactor ? options.redactor.redact(outcome.result) : outcome.result;
            return { content: [{ type: 'text', text: JSON.stringify(result) }] };
          }
          options.onPause?.(a.id, outcome);
          return {
            content: [{ type: 'text', text: JSON.stringify(modelSafeOutcome(outcome as FailedOutcome)) }],
            isError: outcome.reason === 'error',
          };
        },
      );
    }
  }
}
