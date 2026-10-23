import { HarnessDisabledError } from '@/lib/harness/registry';
import { normalizeContentAliases, normalizeHomeDestination } from '@/lib/team/mcp/input';
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
import { actionCatalog, type ActionName, type ActionOutput } from './registry';
import type { Action, ActionContext } from './types';
import { ActionError } from './types';
import { isPersonalAiClientKey, permitsHomeContentAction } from '@/lib/external-ai/policy';
import { isTeamAuthority } from '@/lib/home/authority';
import { getApiKey, getChatSession, getHome, isNoteKindError, isTeamError, isTeamChatError } from '@/lib/db/queries';
import { LifecycleConflictError } from '@/lib/sessions/lifecycle-admission';
import { HarnessSelectionError } from '@/lib/harness/model-discovery';

export function findAction(name: string): Action | undefined {
  return actionCatalog(isTeamAuthority()).find((a) => a.name === name);
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
  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    try { rawInput = normalizeHomeDestination(rawInput as Record<string, unknown>, action?.params ?? {}); }
    catch (error) { return { ok: false, action: name, error: { code: 'invalid_params', message: error instanceof Error ? error.message : 'Invalid destination.' } }; }
  }
  if (ctx.caller?.scope === 'home_content') {
    if (rawInput && typeof rawInput === 'object' && 'target_home_id' in rawInput) return { ok: false, action: name, error: { code: 'unsupported', message: 'This external connection is scoped to its personal Home.' } };
    const key = ctx.caller.apiKeyId ? getApiKey(ctx.caller.apiKeyId) : null;
    if (isTeamAuthority() || !key || !isPersonalAiClientKey(key) || key.revokedAt
      || (key.expiresAt && new Date(key.expiresAt).getTime() <= Date.now()) || !permitsHomeContentAction(name)) {
      return { ok: false, action: name, error: { code: 'unsupported', message: 'This external connection cannot use that tool.' } };
    }
  }
  if (!action) {
    return {
      ok: false,
      action: name,
      error: { code: 'unknown_action', message: `Unknown action: ${name}` },
    };
  }

  if (rawInput && typeof rawInput === 'object' && 'target_home_id' in rawInput && !action.params.target_home_id && rawInput.target_home_id !== getHome()?.id) {
    return { ok: false, action: name, error: { code: 'unsupported', message: 'This operation cannot target that Home. No personal write was attempted.' } };
  }

  if (rawInput && typeof rawInput === 'object' && !Array.isArray(rawInput)) {
    const fields = { ...rawInput } as Record<string, unknown>;
    if (!action.params.target_home_id && fields.target_home_id === getHome()?.id) delete fields.target_home_id;
    try { rawInput = normalizeContentAliases(fields, action.localContract?.params ?? action.params); }
    catch (error) { return { ok: false, action: name, error: { code: 'invalid_params', message: error instanceof Error ? error.message : 'Conflicting aliases.' } }; }
  }
  const objectSchema = z.object(ctx.caller?.scope === 'home_content' ? action.localContract?.params ?? action.params : action.params);
  const schema = ctx.caller?.scope === 'home_content' ? objectSchema : action.strictParams || ['get_handoff_context', 'report_result', 'get_result', 'list_results', 'request_result_review', 'report_result_review'].includes(name) ? objectSchema.strict() : objectSchema;
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
    const targetHome = (parsed.data as Record<string, unknown>).target_home_id;
    if (action.mutating && !serverReport && (!targetHome || targetHome === getHome()?.id)) {
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
    // A note's kind refused at the query layer is the caller's to fix.
    if (isNoteKindError(err)) return { ok: false, action: name, error: { code: 'invalid_params', message: err.message } };
    if (err instanceof LifecycleConflictError) return { ok: false, action: name, error: { code: 'conflict', message: err.message } };
    if (err instanceof HarnessDisabledError) return { ok: false, action: name, error: { code: 'unsupported', message: err.message } };
    if (err instanceof HarnessSelectionError) return { ok: false, action: name, error: { code: err.code, message: err.message } };
    if (isTeamError(err) || isTeamChatError(err)) return { ok: false, action: name, error: {
      code: err.code === 'not_found' ? 'not_found' : err.code === 'conflict' ? 'conflict' : err.code === 'not_allowed' || err.code === 'unavailable' ? 'unsupported' : 'invalid_params',
      message: err.message,
    } };
    const message = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      action: name,
      error: { code: 'internal_error', message },
    };
  }
}
