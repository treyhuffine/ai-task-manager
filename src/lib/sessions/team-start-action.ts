/** Native tool adapter onto the same launch and message operations as the UI. */
import { createHash } from 'node:crypto';
import * as q from '@/lib/db/queries';
import type { ActionContext } from '@/lib/orchestrator/types';
import { ActionError } from '@/lib/orchestrator/types';
import { actorFromAction } from '@/lib/auth/actor';
import { authorizeTeamActorExecution } from '@/lib/home/execution-authority';
import { dispatchExecutionSession, TaskNotStartableForDispatch, type DispatchExecutionSessionArgs } from './dispatch';
import { sendToTeamAi, TEAM_CHAT_MESSAGE_MAX } from '@/lib/team/ai/chat';
import { verifyLaunchReplay } from './home-policy';
import { processState } from '@/lib/process-state';
import { getDbPath } from '@/lib/config/paths';
import { teamAgentAvailability } from '@/lib/team/ai/native-turn';
import { requireHarnessId } from '@/lib/harness/options';
import { resolveStartSelection } from '@/lib/harness/start-selection';

const launches = processState('sessions.team-launches', () => new Map<string, Promise<unknown>>());
type TeamLaunchInput = {
  workspaceId: string; prompt: string; requestId: string; provider?: DispatchExecutionSessionArgs['harness'];
  serviceTier?: string | null;
  model?: string; effort?: DispatchExecutionSessionArgs['effort']; permissionMode?: DispatchExecutionSessionArgs['permissionMode'];
  taskId?: string; label?: string; deviceId?: string;
};

export function startTeamExecutionAction(ctx: ActionContext, input: TeamLaunchInput) {
  const actor = actorFromAction(ctx);
  const authority = authorizeTeamActorExecution(actor, { operation: 'start', workspaceId: input.workspaceId });
  const key = JSON.stringify([getDbPath(), authority.member.id, input.workspaceId, input.requestId]);
  const prior = launches.get(key) ?? Promise.resolve();
  const next = prior.catch(() => {}).then(() => startTeamExecutionUnlocked(ctx, input));
  launches.set(key, next);
  void next.finally(() => { if (launches.get(key) === next) launches.delete(key); }).catch(() => {});
  return next;
}

async function startTeamExecutionUnlocked(ctx: ActionContext, input: TeamLaunchInput) {
  const text = input.prompt.trim();
  if (!text || text.length > TEAM_CHAT_MESSAGE_MAX) throw new ActionError('invalid_params', `Write a message of 1 to ${TEAM_CHAT_MESSAGE_MAX.toLocaleString()} characters.`);
  const actor = actorFromAction(ctx);
  const authority = authorizeTeamActorExecution(actor, { operation: 'start', workspaceId: input.workspaceId });
  const defaults = q.getTeamAiSettings();
  const id = createHash('sha256').update(JSON.stringify(['native-team-execution', authority.member.id, input.workspaceId, input.requestId])).digest('hex');
  const sessionId = `${id.slice(0, 8)}-${id.slice(8, 12)}-8${id.slice(13, 16)}-a${id.slice(17, 20)}-${id.slice(20, 32)}`;
  const existing = q.getChatSession(sessionId);
  const harness = input.provider ?? existing?.harness ?? defaults?.harness;
  if (!harness) throw new ActionError('unsupported', 'Choose a team harness.');
  const intent = createHash('sha256').update(JSON.stringify(['native-team-start-v1', input.workspaceId, text, input.provider ?? null, input.model ?? null, input.effort ?? null, input.permissionMode ?? null, input.taskId ?? null, input.label ?? null, input.deviceId ?? null, input.serviceTier ?? null])).digest('hex');
  const receipt = existing ? q.findTeamChatSend(existing.id, authority.member.id, `native-start:${input.requestId}`) : null;
  const legacyReceipt = receipt && q.matchesTeamChatSend(receipt.message, { text });
  const savedIntent = existing ? q.getChatEventById(`native-launch-intent:${existing.id}`) : null;
  const savedHash = (savedIntent?.raw as { actionIntentHash?: string } | null)?.actionIntentHash;
  if (existing && (savedHash ? savedHash !== intent : !receipt)) throw new ActionError('conflict', 'This launch request already belongs to different or unrecorded work. Use a new request ID for a new brief.');
  if (!receipt) {
    const available = await teamAgentAvailability({ workspaceId: input.workspaceId, harness: requireHarnessId(harness) });
    if (available.state !== 'ready') throw new ActionError('unsupported', available.reason ?? 'This team harness is unavailable.');
  }
  let session: Awaited<ReturnType<typeof dispatchExecutionSession>>;
  try { session = await dispatchExecutionSession({ ...input, harness, sessionId, actor, nativeLaunchIntentHash: intent }); }
  catch (error) {
    if (error instanceof TaskNotStartableForDispatch) throw new ActionError(error.taskStatus === 'not_found' ? 'not_found' : error.taskStatus === 'conflict' ? 'conflict' : 'invalid_params', error.message);
    throw error;
  }
  if (existing && !savedHash && (!receipt || legacyReceipt)) {
    const normalized = !receipt ? await resolveStartSelection({ providerId: requireHarnessId(harness), model: input.model, effort: input.effort, serviceTier: input.serviceTier }, { cwd: authority.workspace!.cwd }) : null;
    if ((input.provider && session.harness !== input.provider) || (input.model && session.model !== (normalized?.model ?? input.model))
      || (input.serviceTier !== undefined && session.serviceTier !== input.serviceTier) || (input.effort && session.effort !== (normalized?.effort ?? input.effort)) || (input.permissionMode && session.permissionMode !== input.permissionMode)) throw new ActionError('conflict', 'This launch request already selected different settings.');
  }
  verifyLaunchReplay(input.workspaceId, session, actor);
  const sent = await sendToTeamAi({ chatId: session.id, memberId: authority.member.id, requestingApiKeyId: actor.apiKeyId,
    clientSendId: `native-start:${input.requestId}`, text, actionIntentHash: legacyReceipt ? undefined : intent, senderSessionId: actor.sessionId ?? undefined });
  return { started: !existing, sessionId: session.id, executionId: session.executionId, workspace: { id: authority.workspace!.id, name: authority.workspace!.name }, requestId: input.requestId, note: sent.created ? 'Started in the team server.' : 'Returned the original team execution.' };
}
