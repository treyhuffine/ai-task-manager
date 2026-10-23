/**
 * Main chats (docs/agents-view-spec.md §4 and Phase 5): the app's main chat
 * (no workspace) and each agent's main chat (its workspace). A scope has one
 * current chat at a time. "New chat" retires it and starts another, history
 * lists past ones, and resume brings one back.
 *
 * `/api/orchestrator-chat/*` (scope `null`) and `/api/workspaces/:id/chat/*`
 * (scope = the workspace id) are thin wrappers over this, so the two can
 * never drift apart. Scheduled orchestrator fires also create orchestration
 * chats, but they carry `createdByRunId` and are never main chats
 * (`listMainChats`).
 */

import {
  TeamError, getMemberPreferences, setMemberCurrentMainChat,
  createChatSession,
  getChatSession,
  getLastChatEventBySource,
  getUserState,
  listMainChats,
  updateChatSession,
} from '@/lib/db/queries';
import { EFFORT_LEVELS, type ChatSessionRecord, type EffortLevel } from '@/db/types';
import type { ProviderId } from '@/lib/harness/options';
import { resolveStartSelection } from '@/lib/harness/start-selection';
import { assertHarnessEnabled, DEFAULT_HARNESS, isKnownHarnessId } from '@/lib/harness/registry';
import { agentDeviceFor } from '@/lib/setups/run-on';
import { permissionsForNewChat } from '@/lib/executor/permission-map';
import { mainChatAuthority, mainChatStartPolicy } from './main-chat-home-policy';
import { retireChatForHome } from './home-policy';
import { getDbPath } from '@/lib/config/paths';
import { processState } from '@/lib/process-state';
import { chatLifecycleClosing, executionLifecycleClosing } from './lifecycle-admission';
import { sessionAuthority } from '@/lib/workspaces/access';
import { executionRequestKey } from '@/lib/home/execution-request';

/** `null` is the app's main chat. A workspace id is that agent's main chat. */
export type MainChatScope = string | null;

/** Optional per-chat provider/model override (the composer's "switch provider"). */
export interface ChatOverride {
  providerId?: ProviderId;
  model?: string;
  variant?: string;
  effort?: EffortLevel;
  serviceTier?: string;
}

export function parseChatOverride(src: unknown): ChatOverride {
  const body = (src && typeof src === 'object' ? src : {}) as {
    providerId?: unknown;
    model?: unknown;
    variant?: unknown;
    effort?: unknown; serviceTier?: unknown;
  };
  const out: ChatOverride = {};
  if (isKnownHarnessId(body.providerId)) out.providerId = body.providerId;
  if (typeof body.model === 'string' && body.model.trim()) out.model = body.model.trim();
  if (typeof body.variant === 'string' && body.variant.trim()) out.variant = body.variant.trim();
  if (typeof body.effort === 'string' && EFFORT_LEVELS.includes(body.effort as EffortLevel)) {
    out.effort = body.effort as EffortLevel;
  }
  if (typeof body.serviceTier === 'string') out.serviceTier = body.serviceTier;
  return out;
}

/** The scope's current chat, or null when it has none yet. */
export function currentMainChat(scope: MainChatScope): ChatSessionRecord | null {
  const authority = mainChatAuthority(scope);
  if (authority) {
    const selected = getMemberPreferences(authority.member.id)?.currentMainChats[scope!];
    if (!selected) return null;
    const chat = selected ? getChatSession(selected) : null;
    return chat?.workspaceId === scope && chat.status === 'active' && chat.type === 'orchestration' && !chat.executionId && !chat.createdByRunId ? chat : null;
  }
  return listMainChats(scope, { status: 'active', limit: 1 })[0] ?? null;
}

async function createMainChat(
  scope: MainChatScope,
  override: ChatOverride,
  permissions?: Pick<ChatSessionRecord, 'permissionMode' | 'prePlanMode'>,
  policy?: Awaited<ReturnType<typeof mainChatStartPolicy>>,
): Promise<ChatSessionRecord> {
  const contextual = policy === undefined ? await mainChatStartPolicy(scope, override) : policy;
  const selection = contextual?.selection ?? await resolveStartSelection(override);
  contextual?.verify();
  const session = createChatSession({
    ...permissions,
    ...(contextual?.permissionMode ? { permissionMode: contextual.permissionMode, prePlanMode: contextual.prePlanMode ?? null } : {}),
    ...(contextual ? { createdByMemberId: contextual.memberId, surfaceKind: contextual.surfaceKind } : {}),
    type: 'orchestration',
    workspaceId: scope,
    // An agent's main chat is pinned where the agent lives (P3.4). The app's
    // own main chat, and an agent set up at home, run at home.
    deviceId: contextual?.deviceId ?? (scope ? agentDeviceFor(scope) : null),
    harness: selection.providerId,
    model: selection.model,
    modelVariant: selection.variant,
    effort: selection.effort,
    serviceTier: selection.serviceTier,
    // Label stays null while the chat is live. Main chats get a
    // retrospective summary when they are retired (`retireMainChat`), and
    // the messages route never derives a first-message title for
    // orchestration chats.
    label: null,
    status: 'active',
  });
  // A chat starts on the default. Starting one, even on another harness,
  // doesn't change it (docs/default-selection.md).
  selectMainChat(scope, session.id);
  return session;
}

function selectMainChat(scope: MainChatScope, chatId: string) {
  const authority = mainChatAuthority(scope);
  if (authority && scope) setMemberCurrentMainChat(authority.member.id, scope, chatId);
}

/** One lifecycle writer per Home and scope, shared by every server bundle. */
const lifecycle = processState('sessions:main-chat-lifecycle', () => ({ pending: new Map<string, Promise<unknown>>() }));
function serializeMainChatChange<T>(scope: MainChatScope, work: () => Promise<T>): Promise<T> {
  const key = JSON.stringify([getDbPath(), scope]);
  const before = lifecycle.pending.get(key) ?? Promise.resolve();
  const next = before.catch(() => {}).then(work);
  lifecycle.pending.set(key, next);
  void next.finally(() => { if (lifecycle.pending.get(key) === next) lifecycle.pending.delete(key); }).catch(() => {});
  return next;
}

/** The scope's current chat, created when it has none ("ensure" semantics). */
export function ensureMainChat(scope: MainChatScope): Promise<ChatSessionRecord> {
  return serializeMainChatChange(scope, async () => {
    const current = currentMainChat(scope);
    if (current) return current;
    const session = await createMainChat(scope, {});
    mainChatAuthority(scope);
    return session;
  });
}

/**
 * Take a chat off the stage: close its cached harness process so it doesn't
 * linger, archive it, and title it retrospectively. Archive is the one moment
 * a thread's whole arc is known (fire-and-forget: history shows a snippet
 * until the summary lands, or forever if the call fails).
 */
async function retireMainChat(id: string): Promise<void> {
  const deriveLabel = await retireChatForHome(id);
  if (deriveLabel) {
    const { deriveRetrospectiveLabel } = await import('@/lib/sessions/derive-label');
    void deriveRetrospectiveLabel(id);
  }
}

/** Add a conversation without retiring another member's current work. */
export function addMainChat(scope: MainChatScope, override: ChatOverride = {}): Promise<ChatSessionRecord> {
  return serializeMainChatChange(scope, async () => {
    const policy = await mainChatStartPolicy(scope, override);
    const current = currentMainChat(scope);
    const harness = policy?.selection.providerId ?? override.providerId ?? current?.harness ?? getUserState()?.defaultHarness ?? DEFAULT_HARNESS;
    return createMainChat(scope, override, permissionsForNewChat(harness, current), policy);
  });
}

/** A new main chat an app asked for, refused because the person has written in the current one (`forApp`). */
export class MainChatInUseError extends Error {
  readonly code = 'main_chat_in_use';
  constructor() { super('This chat has your conversation in it, so a new chat wasn\'t started.'); this.name = 'MainChatInUseError'; }
}

/**
 * Start fresh: retire the current chat and create a new one. Used by "New
 * chat", by the composer's provider switch, and by mode switches (spawn
 * flags are read when the process starts, so a new chat is the clean cut).
 *
 * `forApp` is a new chat a connected app asked for (`target: "new"`), where
 * the app's draft goes. An app needs no click to ask, and retiring a chat
 * archives the person's conversation and ends any work in it, so an app
 * never retires one: a current chat nobody has written in is already new and
 * is kept, and one the person has written in is refused
 * (`MainChatInUseError`), its draft going there instead. Only the person
 * starts over.
 */
export function startNewMainChat(scope: MainChatScope, override: ChatOverride = {}, options: { forApp?: boolean; sourceChatId?: string } = {}): Promise<ChatSessionRecord> {
  return serializeMainChatChange(scope, () => startNewMainChatUnlocked(scope, override, options));
}
async function startNewMainChatUnlocked(scope: MainChatScope, override: ChatOverride, options: { forApp?: boolean; sourceChatId?: string }): Promise<ChatSessionRecord> {
  const policy = await mainChatStartPolicy(scope, override);
  // A disabled explicit choice must fail before retiring the current chat.
  const harness = policy?.selection.providerId ?? override.providerId ?? getUserState()?.defaultHarness ?? DEFAULT_HARNESS;
  assertHarnessEnabled(harness);
  const current = currentMainChat(scope);
  if (options.forApp && current) {
    if (!getLastChatEventBySource(current.id, 'user')) return current;
    throw new MainChatInUseError();
  }
  const viewed = options.sourceChatId ? getChatSession(options.sourceChatId) : current;
  if (options.sourceChatId) {
    if (!viewed || viewed.workspaceId !== scope || viewed.type !== 'orchestration' || viewed.executionId || viewed.createdByRunId) throw new TeamError('not_found', 'Choose a main chat of this agent.');
    sessionAuthority(executionRequestKey(), viewed.id, 'read');
    if (chatLifecycleClosing(viewed.id)) throw new TeamError('conflict', 'This chat is being closed. Try again after it finishes.');
  }
  const permissions = permissionsForNewChat(harness, viewed);
  if (policy) return createMainChat(scope, override, permissions, policy);
  if (current) await retireMainChat(current.id);
  return createMainChat(scope, override, permissions, policy);
}

export const MAIN_CHAT_HISTORY_LIMIT = 50;
const SNIPPET_MAX = 80;

export interface MainChatHistoryEntry {
  id: string;
  /** Retrospective summary, written when the chat is archived. Null while live. */
  label: string | null;
  /** Last user message, truncated: the live fallback until the summary lands. */
  snippet: string | null;
  status: 'active' | 'archived';
  startedAt: string;
  lastOutcomeEventAt: string | null;
  lastActivityAt: string | null;
}

/** Past and current chats in the scope, newest activity first. Capped. */
export function mainChatHistory(scope: MainChatScope): MainChatHistoryEntry[] {
  mainChatAuthority(scope);
  return listMainChats(scope, { limit: MAIN_CHAT_HISTORY_LIMIT }).map((s) => {
    const lastUser = getLastChatEventBySource(s.id, 'user');
    const raw = lastUser?.content?.trim().replace(/\s+/g, ' ') ?? null;
    const snippet =
      raw && raw.length > SNIPPET_MAX ? raw.slice(0, SNIPPET_MAX - 1).trimEnd() + '…' : raw;
    return {
      id: s.id,
      label: s.label,
      snippet,
      status: s.status,
      startedAt: s.startedAt,
      lastOutcomeEventAt: s.lastOutcomeEventAt,
      lastActivityAt: s.lastActivityAt,
    };
  });
}

export type ResumeMainChatResult =
  | { ok: true; session: ChatSessionRecord }
  | { ok: false; status: 404; error: string };

/**
 * Make a past chat in the scope current again. The previous current chat is
 * retired. The harness resumes for free: the next send re-spawns via the
 * chat's persisted `externalSessionId`, so the model picks the conversation
 * up from its on-disk transcript. A chat from another scope is refused, so
 * an agent's history can never pull in the app's main chat or another
 * agent's.
 *
 * Spawn flags (MCP attachment, tool guards) are applied at dispatch, so a
 * chat that ran under the retired Skills mode continues on MCP.
 */
export function resumeMainChat(scope: MainChatScope, sessionId: string): Promise<ResumeMainChatResult> {
  return serializeMainChatChange(scope, () => resumeMainChatUnlocked(scope, sessionId));
}
async function resumeMainChatUnlocked(scope: MainChatScope, sessionId: string): Promise<ResumeMainChatResult> {
  const authority = mainChatAuthority(scope);
  const target = getChatSession(sessionId);
  const inScope = target
    && target.type === 'orchestration'
    && target.createdByRunId === null
    && target.executionId === null
    && (target.workspaceId ?? null) === scope;
  if (!target || !inScope) {
    return {
      ok: false,
      status: 404,
      error: scope === null ? 'Not an interactive orchestrator chat' : "Not one of this agent's main chats",
    };
  }

  if (chatLifecycleClosing(target.id) || executionLifecycleClosing(target.executionId)) throw new TeamError('conflict', 'This chat is being closed. Try again after it finishes.');
  const current = currentMainChat(scope);
  if (current?.id === target.id) return { ok: true, session: target };
  if (current && !authority) await retireMainChat(current.id);

  mainChatAuthority(scope);

  const session = target.status === 'archived'
    ? updateChatSession(target.id, { status: 'active', archivedAt: null }) ?? target
    : target;
  selectMainChat(scope, session.id);
  return { ok: true, session };
}
