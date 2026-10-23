import { recordHomeActivity } from '@/lib/home/activity';
import { getRequestKey } from '@/lib/auth/request-key';
import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';
import { closeChatAdmission } from '@/lib/sessions/lifecycle-admission';
import { runningTeamChatTurn, TeamChatError } from '@/lib/db/queries';
import { stopTeamAiWork, kickTeamChat } from '@/lib/team/ai/chat';
import { actorFromRequest } from '@/lib/auth/actor';
import * as executor from '@/lib/executor/adapter';
import { clearHarnessRuntimeCache } from '@/lib/harness/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * User-initiated "Restart agent" — recycle the coding session's CLI
 * subprocess without losing the conversation.
 *
 * We keep coding sessions open for the life of the server (snappy reuse,
 * no idle spin-down), so a long-lived process never picks up an in-place
 * CLI upgrade and can accumulate working-memory cruft. This is the manual
 * escape hatch: force-close the cached subprocess so the very next send
 * spawns a fresh one, resuming the on-disk transcript via `--resume`.
 *
 * Distinct from Resync (`/resync`): Restart does NOT force a transcript
 * replay or re-fire any unanswered message — it only kills the process.
 * Restart is the proactive "give me a clean process / pick up the new
 * binary" gesture; Resync is the reactive "this session is stuck, recover
 * it" gesture.
 *
 * Also flush the harness runtime cache (60s TTL on the reported version +
 * model catalog) so the UI reflects an in-place binary upgrade immediately
 * rather than up to a minute later.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const authority = sessionAuthority(getRequestKey(request.headers), id, 'stop');
    const release = closeChatAdmission(id);
    try {
      const result = await executor.close(id, actorFromRequest(request.headers));
      if (!result.closed && !result.queued) throw new TeamChatError('unavailable', result.error ?? 'The harness could not stop. Try restarting again.');
      const turn = authority ? runningTeamChatTurn(id) : null;
      if (turn) await stopTeamAiWork({ turnId: turn.id }, `Restarted by ${authority!.member.name}.`);
      recordHomeActivity(authority, 'restart_harness', id, 'terminal_control');
    } finally { release(); if (authority) kickTeamChat(id); }
    // Whole-cache flush (no harness arg): the resolved binary is shared
    // process-wide, so a version bump should refresh for every session.
    clearHarnessRuntimeCache();
    return reply({ ok: true });
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[POST /api/sessions/:id/restart]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
