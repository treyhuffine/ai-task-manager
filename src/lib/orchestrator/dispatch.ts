/**
 * Shared dispatch core for the orchestrator. Used by both the CLI
 * (`<cli> agent <action>`) and the HTTP MCP (`/api/orchestrator/[transport]`).
 *
 * Given an action name + raw params, validate against the action's Zod schema
 * and invoke the handler. ActionError + ZodError shapes are converted to a
 * stable JSON envelope so CLI and MCP can render them the same way.
 */

import { z } from 'zod';
import type { Action, ActionContext } from './types';
import { ActionError } from './types';
import { actions } from './registry';

export function findAction(name: string): Action | undefined {
  return actions.find((a) => a.name === name);
}

export interface DispatchEnvelope<T = unknown> {
  ok: boolean;
  action: string;
  result?: T;
  error?: {
    code: string;
    message: string;
    suggestion?: string;
    issues?: z.ZodIssue[];
  };
}

export async function runAction(
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

  const schema = z.object(action.params);
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
    const result = await action.handler(ctx, parsed.data);
    return { ok: true, action: name, result };
  } catch (err) {
    if (err instanceof ActionError) {
      return {
        ok: false,
        action: name,
        error: { code: err.code, message: err.message, suggestion: err.suggestion },
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
