import { z } from 'zod';
import { getRequestKey } from '@/lib/auth/request-key';
import { validateWorkResultActor } from './home-policy';
import { ActionError, type ActionContext } from '@/lib/orchestrator/types';
import { mcpCallContext, requestHasSessionAuthority } from '@/lib/orchestrator/mcp-caller';
import { getHome, memberForApiKey, getChatSession, getWorkResultAiReviewForSession } from '@/lib/db/queries';
import type { WorkResultActor } from '@/db/types';
import { isTaskLifecycleError, LIFECYCLE_ERROR_HTTP_STATUS } from '@/lib/tasks/lifecycle';

/** The current home has one authenticated local owner. Never trust an input user ID. */
export function workResultActorFromContext(context: ActionContext, requireAgent = false): WorkResultActor {
  const sessionId = context.actor?.sessionId;
  if (getHome()?.kind === 'team') {
    const member = context.caller?.apiKeyId ? memberForApiKey(context.caller.apiKeyId) : null;
    if (!member || member.id !== context.actor?.memberId || (requireAgent && !sessionId)) throw new ActionError('unsupported', 'This action needs its active team member identity.');
    const actor: WorkResultActor = { userId: 'local', source: sessionId ? 'ai' : 'human', sessionId, memberId: member.id, apiKeyId: context.caller!.apiKeyId, runId: context.actor?.runId };
    validateWorkResultActor(actor, sessionId);
    return actor;
  }
  if (sessionId) {
    const session = getChatSession(sessionId);
    if (session && session.userId !== 'local') throw new ActionError('not_found', 'Authorized source session is unavailable.');
    // Cryptographically authenticated deleted callers can replay committed reports.
    // The query layer rejects all new work from a missing session after replay lookup.
    return { userId: session?.userId ?? 'local', source: 'ai', sessionId, executionId: session?.executionId ?? null, runId: context.actor?.runId ?? null };
  }
  if (requireAgent || context.actor?.source === 'ai' || context.remote) {
    throw new ActionError('unsupported', 'This action requires a signed Ri harness session. Use Save as handoff in the app for existing output.');
  }
  return { userId: 'local', source: 'human' };
}

export function workResultActorFromRequest(request: Pick<Request, 'headers' | 'url' | 'method'>, options: { allowMissing?: boolean } = {}): WorkResultActor {
  const key = getRequestKey(request.headers);
  if (getHome()?.kind === 'team') {
    if (key?.scope !== 'member' || !key.memberId) throw new ActionError('unsupported', 'Results require a team member sign-in.');
    const actor: WorkResultActor = { userId: 'local', source: 'human', memberId: key.memberId, apiKeyId: key.apiKeyId };
    validateWorkResultActor(actor);
    return actor;
  }
  const context = mcpCallContext(request.headers, options);
  const actor = context.actor;
  if (requestHasSessionAuthority(request.headers) && !actor) throw new ActionError('unsupported', 'The session credential is invalid or its source session is unavailable.');
  const resultActor = workResultActorFromContext({ remote: false, actor });
  const session = actor?.sessionId ? getChatSession(actor.sessionId) : null;
  if (session?.surfaceKind === 'result_review') {
    const assigned = getWorkResultAiReviewForSession(session.id, resultActor.userId);
    const path = new URL(request.url).pathname;
    const targetRead = assigned && request.method === 'GET' && (
      path === `/api/results/${assigned.resultId}`
      || (!!assigned.reportResultId && path === `/api/results/${assigned.reportResultId}`)
      || path === `/api/results/reviews/${assigned.id}`
      || path.startsWith(`/api/results/${assigned.resultId}/previews/`)
    );
    const completion = request.method === 'POST' && path === '/api/results/review-reports';
    if (!targetRead && !completion) throw new ActionError('unsupported', 'Background reviewers may only inspect their assigned result and report findings through their completion action.');
  }
  return resultActor;
}

export function workResultErrorResponse(error: unknown): Response {
  if (error instanceof z.ZodError) return Response.json({ error: 'Invalid result parameters.', code: 'invalid_params', issues: error.issues }, { status: 422 });
  if (isTaskLifecycleError(error)) return Response.json({ error: error.message, code: error.code, details: error.details }, { status: LIFECYCLE_ERROR_HTTP_STATUS[error.code] });
  if (error instanceof ActionError) {
    const status = { not_found: 404, invalid_params: 422, conflict: 409, unsupported: 403 }[error.code];
    return Response.json({ error: error.message, code: error.code, details: error.details }, { status });
  }
  console.error('[results]', error);
  return Response.json({ error: 'The result operation failed.', code: 'internal_error' }, { status: 500 });
}

export async function workResultRoute(work: () => unknown | Promise<unknown>): Promise<Response> {
  try { return Response.json(await work()); }
  catch (error) { return workResultErrorResponse(error); }
}
