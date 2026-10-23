/** Home admission for the ordinary dispatcher. The queue supplies a live member turn. */
import type { ChatSessionWithExecution, WorkerCommandActor } from '@/db/types';
import * as q from '@/lib/db/queries';
import { authorizeTeamActorExecution, assertTeamModelSelection } from '@/lib/home/execution-authority';
import { chatLifecycleClosing, chatLifecycleReason, executionLifecycleClosing } from '@/lib/sessions/lifecycle-admission';
import { ExecutorError } from '@/lib/runner/errors';

export function executionDispatchPolicy(session: ChatSessionWithExecution, input: { actor?: WorkerCommandActor; teamTurnId?: string; sourceEventId?: string | null }) {
  const verifyOpen = () => {
    const current = q.getChatSession(session.id);
    if (!current || current.status === 'archived') throw new ExecutorError('invalid_state', 'This chat is closed. Resume it before sending.');
    if (chatLifecycleClosing(session.id) || executionLifecycleClosing(current.executionId)) throw new ExecutorError('already_running', chatLifecycleReason(session.id) ?? 'This chat is being closed. Try again after it finishes.');
  };
  verifyOpen();
  if (q.getHome()?.kind !== 'team') return { personalContext: true, teamTurnId: undefined, catalog: null, verify: verifyOpen, requestingMemberId: null };
  const verify = () => {
    verifyOpen();
    const authority = authorizeTeamActorExecution(input.actor, { operation: 'run', chatId: session.id, turnId: input.teamTurnId });
    assertTeamModelSelection(input.actor, session.harness, session.model);
    const turn = input.teamTurnId ? q.activeTeamChatTurnById(input.teamTurnId, authority.member.id)?.turn : null;
    if (!turn || turn.messageEventId !== input.sourceEventId || turn.requestingApiKeyId !== input.actor?.apiKeyId) throw new q.TeamError('not_allowed', 'A shared send needs its saved member message and current serialized turn.');
    return authority;
  };
  const authority = verify();
  return { personalContext: false, teamTurnId: input.teamTurnId, catalog: null, verify, requestingMemberId: authority.member.id };
}
