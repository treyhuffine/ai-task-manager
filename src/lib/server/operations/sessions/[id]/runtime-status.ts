import { hasTeamCapability } from '@/lib/team/capabilities';
import * as executor from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
import { getRequestKey } from '@/lib/auth/request-key';
import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';
import { runningTeamChatTurn, listTeamChatTurns } from '@/lib/db/queries';

/**
 * Whether this chat_session has an in-flight root turn or detached background
 * work right now. Adapter module state is the single source of truth for the
 * header status and composer behavior.
 *
 * No DB read needed. Module state on the same server is authoritative.
 * If the process restarted, no turn can be running anyway (in-memory
 * AgentSession map is empty).
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const authority = sessionAuthority(getRequestKey(request.headers), id, 'read');
    const turn = authority ? runningTeamChatTurn(id) : null;
    return reply({
      ...(executor.hasUnconfirmedClose(id) ? { closeUnconfirmed: true } : {}),
      ...(executor.unconfirmedCloseProblem(id) ? { closeProblem: executor.unconfirmedCloseProblem(id)! } : {}),
      running: Boolean(turn) || executor.isRunning(id),
      backgroundTasks: executor.hasBackgroundTasks(id),
      backgroundTaskIds: executor.listBackgroundTaskIds(id),
      canStop: authority ? hasTeamCapability(authority.member, 'stopTurn') : true,
      canAnswer: authority ? hasTeamCapability(authority.member, 'answerQuestion') : true,
      canApprove: authority ? hasTeamCapability(authority.member, 'approvePermission') : true,
      activeTurnId: turn?.id ?? null,
      ...(authority ? { teamTurns: listTeamChatTurns(id, { limit: 200 }).map(({ id, messageEventId, memberId, status, error }) => ({ id, messageEventId, memberId, status, error })) } : {}),
    });
  } catch (error) {
    const denied = executionOperationFailure(error);
    if (denied) return denied;
    throw error;
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
