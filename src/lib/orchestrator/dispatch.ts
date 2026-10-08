/**
 * Shared dispatch core for the orchestrator. Used by both the CLI
 * (`<cli> agent <action>`) and the HTTP MCP (`/api/orchestrator/[transport]`).
 *
 * Given an action name + raw params, validate against the action's Zod schema
 * and invoke the handler. ActionError + ZodError shapes are converted to a
 * stable JSON envelope so CLI and MCP can render them the same way.
 */

import { perfScope } from '@/lib/perf/recorder';
import { recordRunArtifacts } from '@/lib/runs/artifact-refs';
import { z } from 'zod';
import { actions, type ActionName, type ActionOutput } from './registry';
import type { Action, ActionContext } from './types';
import { ActionError } from './types';
import { getChatSession } from '@/lib/db/queries';

export function findAction(name: string): Action | undefined {
  return actions.find((a) => a.name === name);
}

export type DispatchEnvelope<T = unknown> =
  | { ok: true; action: string; result: T; error?: never }
  | { ok: false; action: string; result?: never; error: {
    code: string; message: string; suggestion?: string;
    issues?: z.ZodIssue[]; details?: unknown;
  } };

export function runAction<Name extends ActionName>(name: Name, rawInput: unknown, ctx: ActionContext): Promise<DispatchEnvelope<ActionOutput<Name>>>;
export function runAction(name: string, rawInput: unknown, ctx: ActionContext): Promise<DispatchEnvelope>;
export function runAction(
  name: string,
  rawInput: unknown,
  ctx: ActionContext,
): Promise<DispatchEnvelope> {
  // A perf-log scope per action, inside the request that carried it (MCP or
  // the actions route), so an agent's calls show up by name.
  return perfScope(`action:${name}`, () => dispatch(name, rawInput, ctx));
}

async function dispatch(
  name: string,
  rawInput: unknown,
  ctx: ActionContext,
): Promise<DispatchEnvelope> {
  const action = findAction(name);
  if (!action) {
    return {
      ok: false,
      action: name,
      error: { code: 'unknown_action', message: `Unknown action: ${name}` },
    };
  }

  const objectSchema = z.object(action.params);
  const schema = ['get_handoff_context', 'report_result', 'get_result', 'list_results', 'request_result_review', 'report_result_review'].includes(name) ? objectSchema.strict() : objectSchema;
  const parsed = schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    return {
      ok: false,
      action: name,
      error: {
        code: 'invalid_params',
        message: 'Parameter validation failed',
        issues: parsed.error.issues,
      },
    };
  }

  try {
    const serverReport = !ctx.remote && ['report_result', 'report_result_review'].includes(name);
    const caller = ctx.actor?.sessionId && !serverReport ? getChatSession(ctx.actor.sessionId) : null;
    if (caller?.surfaceKind === 'result_review' && !['get_result', 'report_result_review'].includes(name)) {
      throw new ActionError('unsupported', 'Background reviewers may only read their assigned result and report findings.');
    }
    const result = await action.handler(ctx, parsed.data);
    // Attribute what changed to the run in flight in the calling chat, so a
    // run's "what did it change" list is exact whichever transport the agent
    // used (MCP or the CLI from its shell).
    if (action.mutating && !serverReport) {
      recordRunArtifacts({
        actionName: name,
        input: parsed.data as Record<string, unknown>,
        result,
        chatSessionId: ctx.actor?.sessionId,
      });
    }
    return { ok: true, action: name, result };
  } catch (err) {
    if (err instanceof ActionError) {
      return {
        ok: false,
        action: name,
        error: { code: err.code, message: err.message, suggestion: err.suggestion, details: err.details },
      };
    }
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action: name,
      error: { code: 'internal_error', message },
    };
  }
}
