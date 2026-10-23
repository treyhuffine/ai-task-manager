import type { RequestKey } from '@/lib/auth/request-key';
import * as q from '@/lib/db/queries';
import type { MemberRecord, WorkerCommandActor } from '@/db/types';
import { executionRecoveryProblem } from './execution-startup';
import { chatLifecycleClosing, chatLifecycleReason, executionLifecycleClosing } from '@/lib/sessions/lifecycle-admission';
import { hasTeamCapability, type TeamAction } from '@/lib/team/capabilities';
import { requireTeamCapability } from '@/lib/team/capability-authority';

export type ExecutionOperation = 'readCatalog' | 'read' | 'inspectFiles' | 'editFiles' | 'configure' | 'editChat' | 'start' | 'send' | 'run' | 'stop' | 'cancelQueued' | 'answer' | 'approve' | 'archive' | 'terminal';
const ACTIONS: Record<ExecutionOperation, TeamAction> = {
  readCatalog: 'read', read: 'read', inspectFiles: 'read', editFiles: 'editAgentFolder',
  configure: 'configureAgents', editChat: 'editContent', start: 'runTeamAgent', send: 'runTeamAgent', run: 'runTeamAgent',
  stop: 'stopTurn', cancelQueued: 'cancelQueued', answer: 'answerQuestion', approve: 'approvePermission', archive: 'archiveChat', terminal: 'openAgentTerminal',
};
export interface ExecutionAuthorityInput {
  operation: ExecutionOperation;
  workspaceId?: string;
  chatId?: string;
  turnId?: string;
}

export function authorizeTeamExecution(key: RequestKey | null, input: ExecutionAuthorityInput) {
  const member = requireTeamCapability(key, ACTIONS[input.operation]);
  return authorizeMember(member, input, key?.scope === 'member' && !key.sessionChatId ? 'human' : 'agent');
}

/** CLI and agent dispatch retain the saved requesting member, never an ambient owner. */
export function authorizeTeamActorExecution(actor: WorkerCommandActor | undefined, input: ExecutionAuthorityInput) {
  const member = actor?.apiKeyId ? q.memberForApiKey(actor.apiKeyId) : null;
  if (q.getHome()?.kind !== 'team' || !member || member.id !== actor?.memberId) throw new q.TeamError('not_allowed', 'This action needs its active member sign-in.');
  return authorizeMember(member, input, actor?.source === 'human' && !actor.sessionId ? 'human' : 'agent');
}

function authorizeMember(member: MemberRecord, input: ExecutionAuthorityInput, principal: 'human' | 'agent') {
  if (!hasTeamCapability(member, ACTIONS[input.operation], principal)) throw new q.TeamError('not_allowed', 'This caller cannot perform that team action.');
  if (input.operation === 'readCatalog') return { member, chat: null, workspace: null };
  const chat = input.chatId ? q.getChatSession(input.chatId) : null;
  if (input.chatId && !chat) throw new q.TeamError('not_found', 'That chat is gone.');
  if (chat && !q.getTeamChat(chat.id)) throw new q.TeamError('not_allowed', 'Only shared team chats are available to this member.');
  if (input.workspaceId && chat && input.workspaceId !== chat.workspaceId) throw new q.TeamError('not_allowed', 'That chat belongs to a different agent.');
  const workspaceId = input.workspaceId ?? chat?.workspaceId;
  const workspace = workspaceId ? q.getWorkspace(workspaceId) : null;
  if (workspaceId && !workspace) throw new q.TeamError('not_found', 'That agent is gone.');
  const turn = input.turnId ? q.getTeamChatTurn(input.turnId) : null;
  if (['stop', 'cancelQueued', 'answer', 'approve'].includes(input.operation) && input.turnId) {
    if (!turn || (chat && turn.chatSessionId !== chat.id)) throw new q.TeamError('not_found', 'That turn is gone.');
    if (['answer', 'approve'].includes(input.operation) && turn.status !== 'running') throw new q.TeamError('not_allowed', 'This turn is no longer waiting for input.');
  }
  // Existing unbound shared history stays readable. Binding is an explicit next-send choice.
  if (['read', 'editChat', 'send', 'archive', 'stop', 'cancelQueued'].includes(input.operation) && chat?.surfaceKind === q.TEAM_CHAT_SURFACE && !workspace) return { member, chat, workspace: null };
  if (input.operation === 'configure' && !workspaceId) return { member, chat, workspace: null };
  if (!workspace) throw new q.TeamError('not_allowed', 'Choose a team agent first.');
  const placement = chat ? q.chatPlacement(chat.id) : null;
  if (placement && !placement.isHome) throw new q.TeamError('not_allowed', 'Team agents currently run on this team server.');
  if (['read', 'inspectFiles', 'configure', 'editChat', 'editFiles', 'terminal', 'archive', 'stop', 'cancelQueued', 'answer', 'approve'].includes(input.operation)) return { member, chat, workspace };
  if (chat && chatLifecycleClosing(chat.id)) throw new q.TeamError('conflict', chatLifecycleReason(chat.id) ?? 'This chat is being closed. Your draft is kept.');
  if (chat?.executionId && executionLifecycleClosing(chat.executionId)) throw new q.TeamError('conflict', 'This execution is being archived.');
  const recoveryProblem = executionRecoveryProblem();
  if (recoveryProblem) throw new q.TeamError('not_allowed', recoveryProblem);
  if (!q.getTeamAiSettings()?.enabled) throw new q.TeamError('not_allowed', 'Team AI is off. Ask the owner to turn it on in Settings, Team AI.');
  if (workspace.status !== 'active' || (chat && chat.status !== 'active')) throw new q.TeamError('not_allowed', 'This agent or chat is archived. Open an active one to continue.');
  if (input.operation === 'start' && !chat) return { member, chat, workspace };
  if (!chat) throw new q.TeamError('not_found', 'Choose a team chat first.');
  if (input.operation === 'run' && (!turn || turn.chatSessionId !== chat.id || turn.memberId !== member.id || turn.status !== 'running')) throw new q.TeamError('not_allowed', 'A team run requires its live serialized member turn.');
  return { member, chat, workspace };
}

/** Team model visibility is an execution policy for members, including native tools. */
export function assertTeamModelSelection(actor: WorkerCommandActor | undefined, harness: import('@/lib/harness/registry').HarnessId, model: string | null | undefined) {
  if (q.getHome()?.kind !== 'team') return;
  const { member } = authorizeTeamActorExecution(actor, { operation: 'readCatalog' });
  if (!hasTeamCapability(member, 'configureAgents') && (!model || !q.ensureHarnessSettings(harness).enabledModels.includes(model))) {
    throw new q.TeamError('not_allowed', 'Choose a model enabled by the team owner.');
  }
}
