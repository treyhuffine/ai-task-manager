import { actorFromRequestKey } from '@/lib/auth/actor';
import type { RequestKey } from '@/lib/auth/request-key';
import { executionStartPolicy } from '@/lib/sessions/home-policy';
import { bindLegacyTeamChat } from '@/lib/db/team-chat-cutover';
/** Native team policy on the common execution dispatcher, not a provider loop. */
import * as q from '@/lib/db/queries';
import { dispatch, hasUnconfirmedClose, unconfirmedCloseProblem, SessionCloseError } from '@/lib/executor/adapter';
import { getHarnessRuntime, resolveHarnessAuth } from '@/lib/harness/runtime';
import { harnessDefinition } from '@/lib/harness/registry';
import { teamAiMessage, teamAiTurnPrompt, teamTaskScopeContext, type RunTeamTurnInput, type TeamTurnOutcome } from './turn-prompt';
import { withSenderLabel } from '@/lib/sessions/sender';
import { executionRecoveryProblem } from '@/lib/home/execution-startup';
import { expandMarkers } from '@/lib/attachments/expand-markers';

export function isNativeTeamChat(chatId: string) {
  const chat = q.getTeamChat(chatId);
  return Boolean(chat?.workspaceId);
}
export async function teamChatAvailability(chatId: string, candidate?: { workspaceId: string; harness: import('@/lib/harness/registry').HarnessId }) {
  const original = q.getTeamChat(chatId);
  const chat = original && candidate ? { ...original, ...candidate } : original;
  if (!chat) return { state: 'unavailable' as const, reason: 'This chat is gone.' };
  if (!chat.workspaceId) return { state: 'unavailable' as const, reason: 'Choose a team agent to continue this conversation.' };
  if (hasUnconfirmedClose(chat.id)) return { state: 'unavailable' as const, reason: unconfirmedCloseProblem(chat.id) ?? 'The previous harness has not confirmed it stopped. Restart this chat before sending again. Saved changes are preserved.' };
  return teamAgentAvailability({ workspaceId: chat.workspaceId, harness: chat.harness });
}
export async function teamAgentAvailability(chat: { workspaceId: string; harness: import('@/lib/harness/registry').HarnessId }) {
  if (!q.getTeamAiSettings()?.enabled) return { state: 'off' as const, reason: 'Team AI is off. Ask the owner to turn it on in Settings, Team AI.' };
  const recoveryProblem = executionRecoveryProblem();
  if (recoveryProblem) return { state: 'unavailable' as const, reason: recoveryProblem };
  const workspace = q.getWorkspace(chat.workspaceId);
  if (!workspace || workspace.status !== 'active') return { state: 'unavailable' as const, reason: 'This team agent is unavailable.' };
  try {
  const [runtime, auth] = await Promise.all([getHarnessRuntime(chat.harness), resolveHarnessAuth(chat.harness)]);
  if (runtime.binary.status !== 'supported') return { state: 'unavailable' as const, reason: `${harnessDefinition(chat.harness).name} is not installed or supported on this team server.` };
  if (!auth.options.some(option => option.present)) return { state: 'needs_sign_in' as const, reason: `Sign in to ${harnessDefinition(chat.harness).name} on this team server. Everyone on the team uses this sign-in.` };
  return { state: 'ready' as const, reason: null };
  } catch (error) {
    return { state: 'unavailable' as const, reason: error instanceof Error ? error.message : 'The selected harness could not be checked. Try again.' };
  }
}
export async function runNativeTeamTurn(input: RunTeamTurnInput): Promise<TeamTurnOutcome> {
  const turn = q.getTeamChatTurn(input.turn.id);
  if (!turn?.requestingApiKeyId || q.memberForApiKey(turn.requestingApiKeyId)?.id !== turn.memberId) return { status: 'cancelled', reason: 'The requesting sign-in is no longer active.' };
  const signal = input.signal;
  try {
    const message = q.getChatEventById(turn.messageEventId);
    const resultRun = q.workResultOperationForMessage(turn.messageEventId);
    const attachments = message?.attachments ?? [];
    const expanded = await expandMarkers(withSenderLabel(input.text, message?.senderSessionId), attachments);
    const resumed = Boolean(q.getChatSession(turn.chatSessionId)?.externalSessionId);
    const prompt = teamTaskScopeContext(turn.chatSessionId) + (resumed ? teamAiMessage(input.memberName, expanded) : teamAiTurnPrompt({ ...input, text: expanded }));
    await dispatch(turn.chatSessionId, resultRun ? input.text : prompt, {
      ...(resultRun ? { internalCall: true, runId: resultRun.id, resultOperationRunId: resultRun.id } : {}),
      teamTurnId: turn.id, sourceEventId: turn.messageEventId,
      attachments, onTaken: input.onTaken,
      actor: { source: message?.senderSessionId ? 'ai' : 'human', sessionId: message?.senderSessionId, memberId: turn.memberId, apiKeyId: turn.requestingApiKeyId }, signal,
    });
    return signal?.aborted ? { status: 'cancelled' } : { status: 'done' };
  } catch (error) {
    if (error instanceof SessionCloseError) return { status: 'failed', code: 'stop_failed', error: `The previous harness could not stop: ${error.message}. Send again to retry closing it before starting more work.` };
    if (signal?.aborted) return { status: 'cancelled' };
    return { status: 'failed', code: 'runtime', error: error instanceof Error ? error.message : 'This team turn could not start.' };
  }
}

/** Existing chat identity survives binding. Exactly one active agent can be selected on the next send. */
export async function bindTeamChatAgent(chatId: string, key: RequestKey, workspaceId?: string) {
  const chat = q.getTeamChat(chatId);
  if (!chat) throw new q.TeamChatError('not_found', 'That chat is gone.');
  if (chat.workspaceId) return chat;
  const agents = q.listWorkspaces({ status: 'active' });
  const selected = workspaceId ? agents.find(workspace => workspace.id === workspaceId) : agents.length === 1 ? agents[0] : null;
  if (!selected) throw new q.TeamChatError('unavailable', agents.length ? 'Choose a team agent to continue this conversation.' : 'The owner needs to configure a team agent before this conversation can continue. Its history is kept.');
  const policy = await executionStartPolicy(selected, { actor: actorFromRequestKey(key) });
  const availability = await teamChatAvailability(chatId, { workspaceId: selected.id, harness: policy.selection.providerId });
  if (availability.state !== 'ready') throw new q.TeamChatError('unavailable', availability.reason ?? 'This harness is unavailable.');
  policy.verify();
  return bindLegacyTeamChat({ chatId, workspaceId: selected.id, apiKeyId: key.apiKeyId, selection: {
    harness: policy.selection.providerId, model: policy.selection.model, modelVariant: policy.selection.variant,
    effort: policy.selection.effort, serviceTier: policy.selection.serviceTier, permissionMode: chat.permissionMode, prePlanMode: chat.prePlanMode,
  } });
}
