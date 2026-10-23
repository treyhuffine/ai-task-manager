import { hasTeamCapability } from '@/lib/team/capabilities';
/** Result policy at the same authenticated Home boundary as ordinary execution. */
import type { WorkResultActor } from '@/db/types';
import * as q from '@/lib/db/queries';
import { authorizeTeamActorExecution } from '@/lib/home/execution-authority';
import { ActionError } from '@/lib/orchestrator/types';

export function validateWorkResultActor(actor: WorkResultActor, chatId?: string | null, work = false) {
  if (q.getHome()?.kind !== 'team') return null;
  const member = actor.apiKeyId ? q.memberForApiKey(actor.apiKeyId) : null;
  if (!member || member.id !== actor.memberId) throw new ActionError('unsupported', 'This result needs an active team member sign-in.');
  if (chatId) {
    try {
      return authorizeTeamActorExecution({ source: actor.source, memberId: member.id, apiKeyId: actor.apiKeyId }, {
        operation: work ? 'send' : 'read', chatId,
      });
    } catch (error) {
      throw new ActionError('unsupported', error instanceof Error ? error.message : 'This team conversation is unavailable.');
    }
  }
  return { member };
}

export function requireWorkResultOwner(actor: WorkResultActor) {
  const authority = validateWorkResultActor(actor);
  if (actor.source !== 'human' || (authority && !hasTeamCapability(authority.member, 'configureAgents'))) throw new ActionError('unsupported', 'Only the owner can change result capabilities.');
}

export function requireWorkResultRequester(actor: WorkResultActor, _requestedBy: string | null | undefined) {
  const authority = validateWorkResultActor(actor);
  if (authority && !hasTeamCapability(authority.member, 'stopTurn', actor.source === 'human' ? 'human' : 'agent')) throw new ActionError('unsupported', 'This member cannot control team work.');
}
