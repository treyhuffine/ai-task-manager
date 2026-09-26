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
  archiveChatSession,
  createChatSession,
  ensureHarnessSettings,
  getChatSession,
  getLastChatEventBySource,
  getUserState,
  listMainChats,
  updateChatSession,
  updateUserState,
} from '@/lib/db/queries';
import { EFFORT_LEVELS, type ChatSessionRecord, type EffortLevel } from '@/db/types';
import type { ProviderId } from '@/lib/harness/options';
import { resolveHarnessSelection } from '@/lib/harness/model-discovery';
import { isHarnessId } from '@/lib/harness/registry';
import { mainChatComputerFor } from '@/lib/setups/run-on';

/** `null` is the app's main chat. A workspace id is that agent's main chat. */
export type MainChatScope = string | null;

/** Optional per-chat provider/model override (the composer's "switch provider"). */
export interface ChatOverride {
  providerId?: ProviderId;
  model?: string;
  variant?: string;
  effort?: EffortLevel;
}

export function parseChatOverride(src: unknown): ChatOverride {
  const body = (src && typeof src === 'object' ? src : {}) as {
    providerId?: unknown;
    model?: unknown;
    variant?: unknown;
    effort?: unknown;
  };
  const out: ChatOverride = {};
  if (isHarnessId(body.providerId)) out.providerId = body.providerId;
  if (typeof body.model === 'string' && body.model.trim()) out.model = body.model.trim();
  if (typeof body.variant === 'string' && body.variant.trim()) out.variant = body.variant.trim();
  if (typeof body.effort === 'string' && EFFORT_LEVELS.includes(body.effort as EffortLevel)) {
    out.effort = body.effort as EffortLevel;
  }
  return out;
}

/** The scope's current chat, or null when it has none yet. */
export function currentMainChat(scope: MainChatScope): ChatSessionRecord | null {
  return listMainChats(scope, { status: 'active', limit: 1 })[0] ?? null;
}

async function createMainChat(scope: MainChatScope, override: ChatOverride): Promise<ChatSessionRecord> {
  const userState = getUserState();
  const providerId = override.providerId
    ?? userState?.defaultHarness
    ?? 'claude';
  const savedTupleMatchesProvider = userState?.defaultHarness === providerId;
  const harnessSettings = ensureHarnessSettings(providerId);
  const requestedModel = override.model
    ?? (savedTupleMatchesProvider ? userState?.defaultModel : null)
    ?? harnessSettings.defaultModel;
  const selection = await resolveHarnessSelection(providerId, {
    model: requestedModel,
    variant: override.variant
      ?? (requestedModel === harnessSettings.defaultModel ? harnessSettings.defaultVariant : null),
    effort: override.effort
      ?? (savedTupleMatchesProvider ? userState?.defaultEffort : null)
      ?? harnessSettings.defaultEffort,
  }, { repairInvalidModel: override.model === undefined });
  const session = createChatSession({
    type: 'orchestration',
    workspaceId: scope,
    // An agent's main chat is pinned where the agent lives (P3.4). The app's
    // own main chat, and an agent set up at home, run at home.
    computerId: scope ? mainChatComputerFor(scope) : null,
    harness: selection.providerId,
    model: selection.model,
    modelVariant: selection.variant,
    effort: selection.effort,
    // Label stays null while the chat is live. Main chats get a
    // retrospective summary when they are retired (`retireMainChat`), and
    // the messages route never derives a first-message title for
    // orchestration chats.
    label: null,
    status: 'active',
  });
  updateUserState({
    defaultHarness: selection.providerId,
    defaultModel: selection.model,
    defaultEffort: selection.effort,
  });
  return session;
}

/**
 * Concurrent opens of the same scope share one create, so two tabs (or a
 * double render) opening an agent at once never leave two current chats.
 * On globalThis so every route bundle sees the same map.
 */
const INFLIGHT_KEY = Symbol.for('ri.mainChat.inflight');
const inflight: Map<string, Promise<ChatSessionRecord>> =
  ((globalThis as Record<symbol, unknown>)[INFLIGHT_KEY] as Map<string, Promise<ChatSessionRecord>> | undefined)
  ?? ((globalThis as Record<symbol, unknown>)[INFLIGHT_KEY] = new Map());

/** The scope's current chat, created when it has none ("ensure" semantics). */
export async function ensureMainChat(scope: MainChatScope): Promise<ChatSessionRecord> {
  const current = currentMainChat(scope);
  if (current) return current;
  const key = scope ?? '';
  const pending = inflight.get(key);
  if (pending) return pending;
  const created = createMainChat(scope, {}).finally(() => inflight.delete(key));
  inflight.set(key, created);
  return created;
}

/**
 * Take a chat off the stage: close its cached harness process so it doesn't
 * linger, archive it, and title it retrospectively. Archive is the one moment
 * a thread's whole arc is known (fire-and-forget: history shows a snippet
 * until the summary lands, or forever if the call fails).
 */
async function retireMainChat(id: string): Promise<void> {
  const { close } = await import('@/lib/executor/adapter');
  await close(id).catch(() => {});
  archiveChatSession(id);
  const { deriveRetrospectiveLabel } = await import('@/lib/sessions/derive-label');
  void deriveRetrospectiveLabel(id);
}

/**
 * Start fresh: retire the current chat and create a new one. Used by "New
 * chat", by the composer's provider switch, and by mode switches (spawn
 * flags are read when the process starts, so a new chat is the clean cut).
 */
export async function startNewMainChat(scope: MainChatScope, override: ChatOverride = {}): Promise<ChatSessionRecord> {
  const current = currentMainChat(scope);
  if (current) await retireMainChat(current.id);
  return createMainChat(scope, override);
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
 * Spawn flags (MCP attachment, tool guards) are read from the current
 * `orchestratorMode` at dispatch, so a chat that ran under another mode
 * continues under the active one.
 */
export async function resumeMainChat(scope: MainChatScope, sessionId: string): Promise<ResumeMainChatResult> {
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

  const current = currentMainChat(scope);
  if (current?.id === target.id) return { ok: true, session: target };
  if (current) await retireMainChat(current.id);

  const session = target.status === 'archived'
    ? updateChatSession(target.id, { status: 'active', archivedAt: null }) ?? target
    : target;
  return { ok: true, session };
}
