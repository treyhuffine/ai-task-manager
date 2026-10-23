import { assertSupportedPermissionMode, conservativePlanReturn } from '@/lib/executor/permission-map';
import { DEFAULT_HARNESS } from '@/lib/harness/registry';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
/** Contextual launch policy. Worktree preparation and execution records stay shared. */
import type { ChatSessionWithExecution, EffortLevel, WorkerCommandActor, WorkspaceRecord } from '@/db/types';
import * as q from '@/lib/db/queries';
import { authorizeTeamActorExecution } from '@/lib/home/execution-authority';
import { resolveStartSelection, type StartOverride } from '@/lib/harness/start-selection';
import { requireHarnessId } from '@/lib/harness/options';
import type { RequestKey } from '@/lib/auth/request-key';
import { authorizeTeamExecution } from '@/lib/home/execution-authority';
import { executionRequestKey } from '@/lib/home/execution-request';
import { sessionAuthority } from '@/lib/workspaces/access';
import { closeChatAdmission } from './lifecycle-admission';
import { actorFromRequestKey } from '@/lib/auth/actor';
import { widensPermissions } from '@/lib/permissions/modes';
type PermissionMode = import('@/db/types').ChatSessionRecord['permissionMode'];
import { agentLaunchPermission, assertAgentLaunchAuthorization } from '@/lib/coordination/permissions';
import { getHarnessModelCatalog } from '@/lib/harness/model-discovery';
import { serviceTierForModel } from '@/lib/harness/service-tiers';
import { assertTeamModelSelection } from '@/lib/home/execution-authority';
import { teamArchiveAuthority } from '@/lib/home/execution-lifecycle-authority';

export async function siblingChatPolicy(key: RequestKey | null, chatId: string, input: { harness: string; model?: string | null; modelVariant?: string | null; effort?: EffortLevel | null; serviceTier?: string | null }) {
  const authority = sessionAuthority(key, chatId, 'read');
  if (!authority) return null;
  const actor = actorFromRequestKey(key!);
  return executionStartPolicy(authority.workspace!, { ...input, actor });
}

export function verifyLaunchReplay(workspaceId: string, existing: ChatSessionWithExecution, actor?: WorkerCommandActor, input?: { workspaceId: string; sessionId?: string | null; coordinationDeliveryId?: string; permissionMode?: PermissionMode }) {
  if (existing.workspaceId !== workspaceId) throw new q.TeamError('conflict', 'That launch id already belongs to different work.');
  if (q.getHome()?.kind !== 'team') {
    agentLaunchPermission(actor, input?.permissionMode, existing.harness, existing);
    assertAgentLaunchAuthorization(actor, input ?? { workspaceId, sessionId: existing.id });
    if (actor?.source === 'ai' && actor.sessionId) q.initializeAgentChildPolicy(actor.sessionId, existing.id);
  } else {
    const authority = authorizeTeamActorExecution(actor, { operation: 'read', chatId: existing.id, workspaceId });
    if (existing.createdByMemberId !== authority.member.id) throw new q.TeamError('conflict', 'That launch id belongs to another member.');
    const inherited = launchPermissions(actor, undefined);
    if (inherited.permissionMode && widensPermissions(inherited.permissionMode, existing.permissionMode)) throw new q.TeamError('not_allowed', 'This existing launch has broader permissions than the sending chat. Use a new request ID.');
    if (existing.permissionMode === 'plan' && inherited.permissionMode) {
      const limit = inherited.permissionMode === 'plan' ? inherited.prePlanMode ?? conservativePlanReturn(existing.harness) : inherited.permissionMode;
      const returnsTo = existing.prePlanMode ?? conservativePlanReturn(existing.harness);
      if (widensPermissions(limit, returnsTo)) throw new q.TeamError('not_allowed', 'This existing plan returns to broader permissions than the sending chat. Use a new request ID.');
    }
  }
}

export async function executionStartPolicy(workspace: WorkspaceRecord, input: {
  actor?: WorkerCommandActor;
  sessionId?: string | null;
  coordinationDeliveryId?: string;
  deviceId?: string | null;
  harness?: string;
  model?: string | null;
  modelVariant?: string | null;
  effort?: EffortLevel | null;
  serviceTier?: string | null;
  permissionMode?: PermissionMode;
}) {
  const team = q.getHome()?.kind === 'team';
  const authority = team ? authorizeTeamActorExecution(input.actor, { operation: 'start', workspaceId: workspace.id }) : null;
  if (team && input.deviceId && input.deviceId !== q.getHome()?.hostDeviceId) throw new q.TeamError('not_allowed', 'Team agents currently run on this team server.');
  const preferred = team ? q.getTeamAiSettings() : null;
  const launchHarness = input.harness ? requireHarnessId(input.harness) : preferred?.harness ?? q.getUserState()?.defaultHarness ?? DEFAULT_HARNESS;
  const permissions = team ? launchPermissions(input.actor, input.permissionMode) : { permissionMode: agentLaunchPermission(input.actor, input.permissionMode, launchHarness) };
  if (!team) assertAgentLaunchAuthorization(input.actor, { ...input, workspaceId: workspace.id });
  const selection = await resolveStartSelection({
    providerId: input.harness ? requireHarnessId(input.harness) : preferred?.harness,
    model: input.model ?? (input.harness && input.harness !== preferred?.harness ? undefined : preferred?.model),
    variant: input.modelVariant, effort: input.effort, serviceTier: input.serviceTier,
  } satisfies StartOverride, { cwd: workspace.cwd, repairInvalidModel: !team || !input.model });
  if (team && input.serviceTier === undefined && input.actor?.sessionId) {
    const sender = q.getChatSession(input.actor.sessionId);
    if (sender?.harness === selection.providerId) {
      const model = (await getHarnessModelCatalog(selection.providerId, { cwd: workspace.cwd })).find(model => model.id === selection.model);
      selection.serviceTier = serviceTierForModel(model, sender.serviceTier);
    }
  }
  assertTeamModelSelection(input.actor, selection.providerId, selection.model);
  try {
    if (permissions.permissionMode) assertSupportedPermissionMode(permissions.permissionMode, selection.providerId);
    if (permissions.prePlanMode) assertSupportedPermissionMode(permissions.prePlanMode, selection.providerId);
  } catch (error) {
    if (!team) throw error;
    throw new q.TeamError('not_allowed', error instanceof Error ? error.message : 'The chosen harness cannot preserve these permissions.');
  }
  return { ...permissions, selection, initialize: (childId: string) => {
    if (!team && input.actor?.source === 'ai' && input.actor.sessionId) q.initializeAgentChildPolicy(input.actor.sessionId, childId);
  }, environment: null, memberId: authority?.member.id ?? null, surfaceKind: authority ? q.TEAM_CHAT_SURFACE : null,
    verify: () => {
      if (!team) { assertAgentLaunchAuthorization(input.actor, { ...input, workspaceId: workspace.id }); return; }
      assertTeamModelSelection(input.actor, selection.providerId, selection.model);
      if (JSON.stringify(launchPermissions(input.actor, input.permissionMode)) !== JSON.stringify(permissions)) throw new q.TeamError('conflict', 'The sending chat permissions changed. Try again.');
      const current = authorizeTeamActorExecution(input.actor, { operation: 'start', workspaceId: workspace.id });
      if (current.workspace?.cwd !== workspace.cwd || current.workspace.isGit !== workspace.isGit) throw new q.TeamError('conflict', 'The team agent changed while this chat was starting. Try again.');
    } };

}

export async function retireChatForHome(id: string): Promise<boolean> {
  const shared = q.getHome()?.kind === 'team';
  if (shared) authorizeTeamExecution(executionRequestKey(), { chatId: id, operation: 'archive' });
  const release = closeChatAdmission(id);
  try {
    const stopped = shared ? (await import('@/lib/team/ai/chat')).markTeamChatStop(id, 'Closing this shared chat interrupted this turn.') : () => {};
    let result: Awaited<ReturnType<typeof import('@/lib/executor/adapter').close>>;
    try { result = await (await import('@/lib/executor/adapter')).close(id, shared ? actorFromRequestKey(executionRequestKey()!) : undefined); }
    catch (error) { stopped(false); throw error; }
    stopped(result.closed);
    if (!result.closed && (shared || !result.queued)) throw new q.TeamChatError('unavailable', result.error ?? 'The harness could not stop. This chat remains open so you can retry.');
    if (shared) await (await import('@/lib/team/ai/chat')).stopTeamAiWork({ chatId: id }, 'This shared chat was closed.');
    (await import('@/lib/workers/undelivered')).withdrawChatQueue(id, 'This chat was closed before it was delivered.');
    q.archiveChatSession(id);
    return !shared;
  } finally { release(); await wakeHomeChatQueues([id]); }
}

/** Closing admission pauses a shared queue. A refusal must wake preserved work. */
export async function wakeHomeChatQueues(ids: readonly string[]): Promise<void> {
  if (q.getHome()?.kind !== 'team') return;
  const { kickTeamChat } = await import('@/lib/team/ai/chat');
  for (const id of ids) kickTeamChat(id);
}

export function executionLifecyclePolicy(session: ChatSessionWithExecution, operation: 'archive' | 'continue' | 'prepare', actor?: WorkerCommandActor) {
  if (q.getHome()?.kind !== 'team') return { actor: actor ?? { source: 'human' as const }, remoteRequired: false, verify: () => {}, beforeClose: async () => () => {}, stop: async () => {} };
  const key = executionRequestKey();
  const caller: WorkerCommandActor | undefined = actor ?? (key?.memberId ? actorFromRequestKey(key) : undefined);
  const read = () => {
    const authority = operation === 'archive' ? teamArchiveAuthority(caller, session.id)
      : authorizeTeamActorExecution(caller, { operation: 'read', chatId: session.id });
    if (!authority.workspace) throw new q.TeamError('not_allowed', 'This chat has no team agent.');
    if (operation !== 'archive') authorizeTeamActorExecution(caller, { operation: 'start', workspaceId: authority.workspace.id });
    return authority;
  };
  read();
  return { actor: caller!, remoteRequired: false, verify: () => { read(); }, beforeClose: async () => {
    const authority = teamArchiveAuthority(caller, session.id);
    const { markTeamChatStop } = await import('@/lib/team/ai/chat');
    const stops = authority.chats.map(chat => ({ id: chat.id, settle: markTeamChatStop(chat.id, 'This shared work was stopped to check whether it can be archived.') }));
    return (closed: ReadonlySet<string>) => { for (const stop of stops) stop.settle(closed.has(stop.id)); };
  }, stop: async () => {
    const authority = teamArchiveAuthority(caller, session.id);
    const { stopTeamAiWork } = await import('@/lib/team/ai/chat');
    await Promise.all(authority.chats.map(chat => stopTeamAiWork({ chatId: chat.id }, 'This shared execution was archived.')));
    read();
  } };
}

/** Starting another chat must never let an agent escape its current mode. */
function launchPermissions(actor: WorkerCommandActor | undefined, requested: PermissionMode | undefined): { permissionMode?: PermissionMode; prePlanMode?: PermissionMode | null } {
  const team = q.getHome()?.kind === 'team';
  if (!team) return { permissionMode: requested };
  if (actor?.source === 'human' && !actor.sessionId) return { permissionMode: requested, prePlanMode: requested === 'plan' ? DEFAULT_PERMISSION_MODE : null };
  const sender = actor?.sessionId ? q.getChatSession(actor.sessionId) : null;
  const inherited = sender?.permissionMode ?? 'ask';
  if (requested && widensPermissions(inherited, requested)) throw new q.TeamError('not_allowed', 'Only a signed-in person can allow broader permissions.');
  const permissionMode = requested ?? inherited;
  return { permissionMode, prePlanMode: permissionMode === 'plan' ? (inherited === 'plan' ? sender?.prePlanMode ?? (sender ? conservativePlanReturn(sender.harness) : 'ask') : inherited) : null };
}

/** Main-chat replacement is a person's pointer change. Agents launch separate work. */
export function mainChatReplacementRefusal(actor: WorkerCommandActor): string | null {
  if (actor.source !== 'ai') return null;
  return q.getHome()?.kind === 'team'
    ? 'Only a person can replace a main chat or switch its harness. Use start_execution to launch separate shared work.'
    : 'Use delegate_work to start an agent-created chat. Replacing a main chat or switching its harness requires the user’s action.';
}
