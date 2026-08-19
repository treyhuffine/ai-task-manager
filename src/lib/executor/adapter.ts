/**
 * Executor adapter — bridge between `@agentex/agent` and our `chat_events`
 * table. Owns the per-session `AgentSession` lifecycle, parses
 * `StreamEvent`s into chat_events rows, and writes them through an
 * `EventWriter` (defaults to the local DB).
 *
 * Module-scope state is intentional: in this single-process Node server,
 * `agentSessions` is the in-memory cache of live AgentSession handles
 * keyed by our `chat_sessions.id`. `runningSessions` is the truth source
 * for "is this turn currently mid-stream"; the runtime-status endpoint
 * reads it. Process restart empties both maps; the next dispatch picks
 * up by passing the persisted `externalSessionId` as `sessionParams`
 * so Claude Code resumes its on-disk JSONL session.
 *
 * Lifecycle assumptions:
 *   - `provider.createSession({ cwd, onEvent, sessionParams })` returns a
 *     handle whose `send(message)` resolves when the agent's turn ends.
 *   - `onEvent` fires for every `StreamEvent` across all turns; we parse
 *     and persist each.
 *   - `onUserInputRequest` routes through `pending-input.ts`. In `bypass`
 *     mode (the default for new sessions) we auto-allow without
 *     surfacing. In `default | accept_edits | plan` we pass the matching
 *     `--permission-mode` flag to Claude and surface every prompt that
 *     comes back through stdio. AskUserQuestion always surfaces.
 *
 * What this module does NOT do (yet):
 *   - SSE streaming back to the client (client polls).
 *   - Rollover handoff message generation when resume fails.
 *   - Cost / token tracking surfacing.
 *   - MCP elicitation.
 */

import { existsSync } from 'node:fs';
import { uuidv7 } from 'uuidv7';
import { getProvider, commandInventoryFromEvent } from '@agentex/agent';
import type {
  AgentSession,
  ProviderConfig,
  StreamEvent,
  UserInputRequest,
  UserInputResponse,
  RuntimeCommandInventory,
} from '@agentex/agent';
import {
  getChatSession,
  getChatSessionWithExecution,
  getAgent,
  getWorkspace,
  getUserState,
  updateChatSession,
  updateUserState,
  listChatSessions,
} from '@/lib/db/queries';
import { getAppRoot } from '@/lib/config/paths';
import {
  installOrchestratorSurface,
  orchestratorSessionConfig,
  connectorsMcpServer,
  renderContentFocusPrompt,
  type OrchestratorMode,
} from '@/lib/orchestrator/harness-surface';
import { listUsableReferenceFolders } from '@/lib/reference-folders/resolve';
import {
  buildReferenceFolderSessionConfig,
  clearReferenceFolderInstructions,
  referenceFolderProviderWiring,
  writeReferenceFolderInstructions,
} from '@/lib/reference-folders/session-config';
import type {
  ChatEventSource,
  CreateChatEventInput,
  PermissionMode,
  EffortLevel,
} from '@/db/types';
import { localEventWriter, type EventWriter } from './event-writer';
import { mapHarnessToProvider } from './harness';
import {
  classifyRequest,
  register as registerPending,
  rejectAllForSession,
  type PendingInput,
} from './pending-input';
import { publishBackgroundTaskActivity, publishRuntime } from '@/lib/realtime/bus';
import {
  decodeBackgroundTaskEvent,
  isActiveBackgroundTaskEvent,
} from './background-task-event';
import { handleRunStreamEvent, registerToolCallName } from '@/lib/runs/event-hooks';
import { resolveSkillDirsForSession } from './skills';
import { beginRun, endRun } from '@/lib/runs/artifact-bucket';
import {
  createRun as createRunRow,
  markRunStarted as markRunStartedRow,
  markRunCompleted as markRunCompletedRow,
  markRunFailed as markRunFailedRow,
  bumpSessionOutcome,
} from '@/lib/db/queries';
import { notifyNeedsInput, notifyRunTerminal } from '@/lib/notifications/emit';
import { budgetGate } from '@/lib/runs/budget';
import {
  explicitAgentSelection,
  providerIdForHarness,
  type ProviderId,
} from '@/lib/agent-options';
import { removeOwnedProjectSkillLinks } from '@/lib/agent-skills/shipped';
import { getHarnessRuntime, runtimeContextForHarness } from '@/lib/agents/runtime';
import { getAgentModelCatalog } from '@/lib/agent-model-discovery';
import { redactAgentRuntimeValue } from '@/lib/agents/redaction';
import { isHarnessEnabled } from '@/lib/agents/registry';

// ─── Public errors ────────────────────────────────────────────

export class ExecutorError extends Error {
  constructor(
    public code:
      | 'not_found'
      | 'invalid_state'
      | 'unsupported'
      | 'already_running'
      | 'budget_exceeded',
    message: string,
  ) {
    super(message);
    this.name = 'ExecutorError';
  }
}

/**
 * Optional opt-in flags for dispatch.
 *
 * `overBudget` — the caller has explicitly acknowledged the budget
 * overage in the UI; we proceed past the block. Otherwise we reject
 * with `budget_exceeded` and the chat surface renders a confirm prompt.
 *
 * `internalCall` — the caller is the scheduled-run wrapper in
 * `src/lib/runs/dispatch.ts` and has already evaluated the budget +
 * execution-mutex gates. Skips both checks; the scheduler is the
 * source of truth for them in this code path. Untrusted callers
 * (chat composer, route handlers) must NOT set this.
 */
export interface DispatchOptions {
  overBudget?: boolean;
  internalCall?: boolean;
}

// ─── Module state ─────────────────────────────────────────────
//
// Stashed on globalThis (with a Symbol key) so the maps survive Next.js
// module re-evaluation across route handlers. Each App Router route is
// bundled independently and may re-import this file with a fresh
// module scope; without globalThis the messages route's `runningSessions`
// would be a different Set than the runtime-status route's, and the UI
// would never see the running flag flip.
//
// Standard pattern — same shape Prisma/Drizzle docs recommend for the
// Next.js dev-mode HMR + bundling story.

interface ExecutorState {
  agentSessions: Map<string, AgentSession>;
  runningSessions: Set<string>;
  /**
   * Number of in-flight preparation and provider-send references per
   * chat_session. With concurrent send (Claude / Codex), multiple sends can overlap:
   * the user types a follow-up while a turn is still in flight, the
   * second dispatch enters while the first is awaiting `result`. A
   * plain `runningSessions: Set` flips off the moment any one
   * dispatch's `finally` runs, even if other dispatches are still
   * outstanding — that flickers the runtime status to false and the
   * UI's Stop button reverts to Send mid-turn. Counting solves it:
   * the flag transitions on 0→1 and N→0 only, so the SSE channel
   * sees clean edges.
   */
  inflightCount: Map<string, number>;
  /** Active provider sends only, excluding pre-dispatch preparation. */
  activeDispatchCount: Map<string, number>;
  /**
   * Current accounting generation for each chat session. Recovery and close
   * advance this value before clearing counts, so finalizers from the retired
   * generation cannot consume replacement-dispatch references.
   */
  dispatchGenerations: Map<string, number>;
  /** Monotonic source for dispatch generations, retained across HMR resets. */
  nextDispatchGeneration: number;
  /** Active provider-neutral background task ids, grouped by chat session. */
  backgroundTasks: Map<string, Set<string>>;
  /**
   * Skill command inventory reported by the provider's session at boot
   * (via `system/init` for Claude — see `commandInventoryFromEvent`).
   * Keyed by our chat session id. Populated once per session lifetime,
   * cleared when the session is dropped. The slash-commands API route
   * reads this to mark `available` on discovered descriptors.
   */
  sessionInventories: Map<string, RuntimeCommandInventory>;
}

const STATE_KEY = Symbol.for('@flow/executor-state');
const globalRef = globalThis as unknown as { [STATE_KEY]?: ExecutorState };

if (!globalRef[STATE_KEY]) {
  globalRef[STATE_KEY] = {
    agentSessions: new Map(),
    runningSessions: new Set(),
    inflightCount: new Map(),
    activeDispatchCount: new Map(),
    dispatchGenerations: new Map(),
    nextDispatchGeneration: 0,
    backgroundTasks: new Map(),
    sessionInventories: new Map(),
  };
} else {
  // HMR migration: state survives from a build that predates these fields.
  if (!globalRef[STATE_KEY].sessionInventories) {
    globalRef[STATE_KEY].sessionInventories = new Map();
  }
  if (!globalRef[STATE_KEY].inflightCount) {
    globalRef[STATE_KEY].inflightCount = new Map();
  }
  if (!globalRef[STATE_KEY].activeDispatchCount) {
    globalRef[STATE_KEY].activeDispatchCount = new Map();
  }
  if (!globalRef[STATE_KEY].dispatchGenerations) {
    globalRef[STATE_KEY].dispatchGenerations = new Map();
  }
  if (typeof globalRef[STATE_KEY].nextDispatchGeneration !== 'number') {
    globalRef[STATE_KEY].nextDispatchGeneration = 0;
  }
  if (!globalRef[STATE_KEY].backgroundTasks) {
    globalRef[STATE_KEY].backgroundTasks = new Map();
  }
}

const {
  agentSessions,
  runningSessions,
  inflightCount,
  activeDispatchCount,
  dispatchGenerations,
  backgroundTasks,
  sessionInventories,
} = globalRef[STATE_KEY]!;

/**
 * Mutate the running flag and notify any SSE subscribers. Only publishes
 * when the value actually changes — `runningSessions` is a Set so naive
 * add/delete are idempotent, but we don't want a same-state publish to
 * burn cycles in subscribers.
 */
function setRunning(chatSessionId: string, running: boolean): void {
  const wasRunning = runningSessions.has(chatSessionId);
  if (running) runningSessions.add(chatSessionId);
  else runningSessions.delete(chatSessionId);
  if (wasRunning !== running) {
    publishRuntime(chatSessionId, running);
  }
}

/**
 * Fold one provider-neutral or legacy Claude lifecycle event into the active
 * background-task snapshot. Returns true when task-id membership changed.
 *
 * Exported as a test seam. The chat-event row remains the durable record while
 * this in-memory index keeps rail snapshots cheap.
 */
export function _recordBackgroundTaskEvent(chatSessionId: string, event: unknown): boolean {
  const task = decodeBackgroundTaskEvent(event);
  if (!task) return false;

  let ids = backgroundTasks.get(chatSessionId);
  let membershipChanged = false;
  if (isActiveBackgroundTaskEvent(task)) {
    if (!ids) {
      ids = new Set();
      backgroundTasks.set(chatSessionId, ids);
    }
    if (!ids.has(task.taskId)) {
      ids.add(task.taskId);
      membershipChanged = true;
    }
  } else if (ids) {
    membershipChanged = ids.delete(task.taskId);
    if (ids.size === 0) backgroundTasks.delete(chatSessionId);
  }

  if (!membershipChanged) return false;
  const isActive = backgroundTasks.has(chatSessionId);
  publishBackgroundTaskActivity(chatSessionId, isActive, listBackgroundTaskIds(chatSessionId));
  return true;
}

function clearBackgroundTasks(chatSessionId: string): void {
  if (!backgroundTasks.delete(chatSessionId)) return;
  publishBackgroundTaskActivity(chatSessionId, false, []);
}

/**
 * Snapshot of every session that's currently running. Used by the rail's
 * `Working` bucket to seed its set on first connect.
 */
export function listRunningSessions(): string[] {
  return Array.from(runningSessions);
}

/** Snapshot of sessions that still have one or more active background tasks. */
export function listBackgroundTaskSessions(): string[] {
  return Array.from(backgroundTasks.keys());
}

/** Whether this session currently has one or more active background tasks. */
export function hasBackgroundTasks(chatSessionId: string): boolean {
  return backgroundTasks.has(chatSessionId);
}

/** Active provider background task ids for one chat session. */
export function listBackgroundTaskIds(chatSessionId: string): string[] {
  return Array.from(backgroundTasks.get(chatSessionId) ?? []);
}

/**
 * The skill/slash command inventory reported by the provider session at
 * boot. Used by the slash-commands API route to gate `available` on
 * each discovered descriptor. Returns null if the session hasn't booted
 * yet or the provider didn't emit an inventory event.
 */
export function getSessionInventory(chatSessionId: string): RuntimeCommandInventory | null {
  return sessionInventories.get(chatSessionId) ?? null;
}

/**
 * Record the runtime command inventory from a provider `system/init`
 * event. First non-null wins — subsequent init events for the same
 * session don't overwrite, so a re-handshake mid-session doesn't
 * clobber the original inventory the UI is reconciling against.
 *
 * Exported with the underscore prefix as a test seam — production
 * code reaches this through the executor's `onEvent` callback.
 */
export function _recordSessionInventory(chatSessionId: string, event: StreamEvent): void {
  const inventory = commandInventoryFromEvent(event);
  if (inventory && !sessionInventories.has(chatSessionId)) {
    sessionInventories.set(chatSessionId, inventory);
  }
}

/** Test / dev escape hatch: drop everything. Not for production paths. */
export function _resetExecutorState(): void {
  // Retire every token handed out before the reset. The monotonic allocator is
  // deliberately not reset, so a late finalizer can never match new work.
  globalRef[STATE_KEY]!.nextDispatchGeneration++;
  agentSessions.clear();
  runningSessions.clear();
  inflightCount.clear();
  activeDispatchCount.clear();
  dispatchGenerations.clear();
  backgroundTasks.clear();
  sessionInventories.clear();
}

// ─── Public API ───────────────────────────────────────────────

export function isRunning(chatSessionId: string): boolean {
  return runningSessions.has(chatSessionId);
}

/**
 * True when a cached AgentSession exists AND its underlying subprocess
 * looks alive. False when there's no cache, the SDK self-reports
 * `state === 'closed'`, or the subprocess has exited/been killed.
 *
 * Health checks call this to distinguish "agent is processing" from
 * "handle is a corpse." The proc inspection is a defensive belt — the
 * SDK's exit handler should set state to 'closed', but the dns-tunnel
 * incident (May 2026) showed that signal can be missed.
 *
 * TODO(agentex): the `proc` peek reaches through `as unknown as` into
 * SDK internals. Push an `isAlive()` (or expose `proc` officially) on
 * `AgentSession` upstream so this layer doesn't have to. If the SDK
 * ever renames the field, we silently degrade to trusting `state`
 * alone — which is the failure mode we're working around in the
 * first place.
 */
export function isAgentSessionAlive(chatSessionId: string): boolean {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return false;
  if (handle.state === 'closed') return false;
  const proc = (handle as unknown as {
    proc?: { killed?: boolean; exitCode?: number | null };
  }).proc;
  if (!proc) return true;
  if (proc.killed) return false;
  if (proc.exitCode !== null && proc.exitCode !== undefined) return false;
  return true;
}

/**
 * Drop a cached AgentSession without awaiting its close. Used by
 * health-check recovery when we've detected the handle is dead — the
 * subprocess is already gone, so there's nothing to gracefully shut
 * down. Next dispatch lazily spawns a fresh one.
 */
export function invalidateAgentSession(chatSessionId: string): void {
  agentSessions.delete(chatSessionId);
  sessionInventories.delete(chatSessionId);
  clearBackgroundTasks(chatSessionId);
}

/**
 * Reset inflight count and runtime flag for a session. Health check
 * uses this after confirming a subprocess is dead — the in-memory
 * accounting drifted past whatever `dispatch`'s finally would have
 * cleared, so we force it back to zero.
 */
export function forceClearInflight(chatSessionId: string): void {
  advanceDispatchGeneration(chatSessionId);
  inflightCount.delete(chatSessionId);
  activeDispatchCount.delete(chatSessionId);
  setRunning(chatSessionId, false);
}

// ─── Inflight reference counting ──────────────────────────────
//
// Concurrent send lets multiple `dispatch()` calls overlap: the user
// types a follow-up while the previous turn is still in flight, the
// second dispatch enters `try` while the first is awaiting `result`.
// A plain `runningSessions.add/.delete` Set flips off the moment any
// one dispatch's finally runs — even while peers are outstanding —
// causing the runtime-status SSE to flicker false and the UI's Stop
// button to revert to Send mid-turn. Counting solves it: the public
// `runningSessions` Set only transitions on 0→1 (start) and N→0
// (everyone's done), so SSE subscribers see clean edges.

export interface DispatchLifecycleRef {
  readonly generation: number;
  readonly kind: 'preparation' | 'active';
}

function currentDispatchGeneration(chatSessionId: string): number {
  const existing = dispatchGenerations.get(chatSessionId);
  if (existing !== undefined) return existing;
  const next = ++globalRef[STATE_KEY]!.nextDispatchGeneration;
  dispatchGenerations.set(chatSessionId, next);
  return next;
}

function advanceDispatchGeneration(chatSessionId: string): number {
  const next = ++globalRef[STATE_KEY]!.nextDispatchGeneration;
  dispatchGenerations.set(chatSessionId, next);
  return next;
}

function startInflight(
  chatSessionId: string,
  kind: DispatchLifecycleRef['kind'],
): DispatchLifecycleRef {
  const next = (inflightCount.get(chatSessionId) ?? 0) + 1;
  inflightCount.set(chatSessionId, next);
  if (next === 1) setRunning(chatSessionId, true);
  return { generation: currentDispatchGeneration(chatSessionId), kind };
}

function endInflight(chatSessionId: string, ref: DispatchLifecycleRef): void {
  if (dispatchGenerations.get(chatSessionId) !== ref.generation) return;
  const cur = inflightCount.get(chatSessionId) ?? 0;
  const next = cur - 1;
  if (next <= 0) {
    inflightCount.delete(chatSessionId);
    setRunning(chatSessionId, false);
  } else {
    inflightCount.set(chatSessionId, next);
  }
}

/**
 * Hold the public runtime flag across asynchronous preparation that happens
 * before `dispatch()` enters its own lifecycle. The messages route persists and
 * acknowledges a user event before worktree repair and provider checks finish.
 * Counting this preparation prevents a false idle gap and balances safely with
 * the nested dispatch count, including concurrent sends.
 */
export function beginDispatchPreparation(chatSessionId: string): DispatchLifecycleRef {
  return startInflight(chatSessionId, 'preparation');
}

export function endDispatchPreparation(
  chatSessionId: string,
  ref: DispatchLifecycleRef,
): void {
  if (ref.kind !== 'preparation') return;
  endInflight(chatSessionId, ref);
}

/**
 * Enter the provider-send portion of a dispatch. Preparation references are
 * intentionally excluded from the concurrency check. The messages route owns
 * one before it calls `dispatch()`, so treating preparation as an active send
 * would reject every first request for providers without concurrent send.
 *
 * Exported as a narrow test seam for the accounting invariant.
 */
export function _beginActiveDispatch(
  chatSessionId: string,
  concurrentSendSupported: boolean,
): DispatchLifecycleRef {
  if (!concurrentSendSupported && activeDispatchCount.has(chatSessionId)) {
    throw new ExecutorError(
      'already_running',
      'This provider does not support concurrent send.',
    );
  }
  activeDispatchCount.set(chatSessionId, (activeDispatchCount.get(chatSessionId) ?? 0) + 1);
  return startInflight(chatSessionId, 'active');
}

/** Complete one provider send while preserving any preparation references. */
export function _endActiveDispatch(chatSessionId: string, ref: DispatchLifecycleRef): void {
  if (ref.kind !== 'active' || dispatchGenerations.get(chatSessionId) !== ref.generation) return;
  const current = activeDispatchCount.get(chatSessionId) ?? 0;
  if (current <= 0) return;
  if (current === 1) activeDispatchCount.delete(chatSessionId);
  else activeDispatchCount.set(chatSessionId, current - 1);
  endInflight(chatSessionId, ref);
}

/**
 * Dispatch a user message into the agent. Fire-and-forget from the
 * route handler — the returned promise resolves when the agent's turn
 * completes, but the caller doesn't have to await it.
 *
 * Concurrent send (Claude + Codex): callable mid-turn. The CLI's own
 * queue handles ordering — Claude drains queued messages into the
 * active turn as `<system-reminder>` attachments on the next tool
 * result; Codex merges them as additional userMessage items in the
 * same turn. Either way the agent's response addresses the new
 * messages without us having to do anything special.
 *
 * Non-concurrent providers such as Cursor and OpenCode reject a second
 * overlapping provider send with
 * `already_running`. Listed in `ExecutorError`'s union so the route
 * can surface it as 409 if it ever fires.
 */
export async function dispatch(
  chatSessionId: string,
  userMessage: string,
  writer: EventWriter = localEventWriter,
  options: DispatchOptions = {},
): Promise<void> {
  const session = getChatSessionWithExecution(chatSessionId);
  if (!session) throw new ExecutorError('not_found', `Session not found: ${chatSessionId}`);

  const agent = getAgent(session.agentId);
  if (!agent) throw new ExecutorError('not_found', `Agent not found: ${session.agentId}`);

  const cwd = resolveCwd(session);
  if (!cwd) throw new ExecutorError('invalid_state', 'Session has no resolvable cwd');

  // Final provider-boundary guard. Live discovery is authoritative for new
  // sends. Historical unavailable selections remain readable, but a missing
  // or disconnected model cannot silently fall through to another model.
  const providerId = providerIdForHarness(agent.harness);
  if (!isHarnessEnabled(providerId)) {
    throw new ExecutorError('unsupported', `${providerId} is disabled by the rollout configuration`);
  }
  const catalog = await getAgentModelCatalog(providerId, { cwd });
  if (session.model && !catalog.some((model) => model.id === session.model)) {
    throw new ExecutorError(
      'invalid_state',
      `Model ${session.model} is unavailable. Reconnect the provider or choose another enabled model.`,
    );
  }
  const selection = explicitAgentSelection(
    providerId,
    { model: session.model, variant: session.modelVariant, effort: session.effort },
    catalog,
  );
  if (session.modelVariant && selection.variant !== session.modelVariant) {
    throw new ExecutorError(
      'invalid_state',
      `Variant ${session.modelVariant} is unavailable for model ${selection.model}.`,
    );
  }
  if (
    selection.model !== session.model
    || selection.variant !== session.modelVariant
    || selection.effort !== session.effort
  ) {
    updateChatSession(session.id, {
      model: selection.model,
      modelVariant: selection.variant,
      effort: selection.effort,
    });
  }
  if (!options.internalCall) {
    const savedSelection = getUserState();
    if (
      savedSelection?.defaultAgentHarness !== selection.providerId
      || savedSelection?.defaultAgentModel !== selection.model
      || savedSelection?.defaultAgentEffort !== selection.effort
    ) {
      updateUserState({
        defaultAgentHarness: selection.providerId,
        defaultAgentModel: selection.model,
        defaultAgentEffort: selection.effort,
      });
    }
  }

  // Budget guard. Manual sends past the monthly ceiling require an
  // explicit `overBudget: true` from the UI's confirmation prompt.
  // Skipped for the scheduled wrapper, which evaluated the gate in
  // `dispatchRun` before getting here.
  if (!options.internalCall && !options.overBudget) {
    if (budgetGate() === 'block') {
      throw new ExecutorError(
        'budget_exceeded',
        'Monthly budget exceeded. Send again with "over budget" confirmation to proceed.',
      );
    }
  }

  // No execution-level run mutex here. Concurrent sends are a
  // first-class feature: a user's follow-up reuses this chat's cached
  // AgentSession (same subprocess) and the provider's native queue
  // absorbs it — Claude drains it as a `<system-reminder>` on the next
  // tool result, Codex merges it into the active turn. The earlier
  // `findActiveRunForExecution` mutex rejected a user's own in-flight
  // `trigger='manual'` turn as if it were a scheduled run. Genuine
  // trigger-vs-trigger worktree contention is governed separately by
  // each trigger's `concurrencyPolicy` in `runs/dispatch.ts`; that
  // path dispatches with `internalCall: true` and never reached this
  // check anyway.

  // Provider capability gate. Claude and Codex support overlapping sends,
  // while providers such as Cursor and OpenCode allow only one active send.
  const runtime = await getHarnessRuntime(selection.providerId, { cwd });
  if (!runtime.capabilities.sessions.supported) {
    throw new ExecutorError(
      'unsupported',
      runtime.capabilities.sessions.reason ?? `${selection.providerId} sessions are unavailable`,
    );
  }
  // Run-row instrumentation (task #12). Every dispatch creates a run row
  // — manual, scheduled, or webhook — so cost tracking and budget
  // guards are honest. The scheduled wrapper sets `internalCall: true`
  // because it has already created the row + registered the run; we
  // only spawn a `triggerKind='manual'` row for top-level callers.
  let manualRun: { runId: string; ownsLifecycle: boolean } | null = null;
  const activeDispatchRef = _beginActiveDispatch(
    chatSessionId,
    runtime.capabilities.concurrentSend.supported,
  );
  try {
    if (!options.internalCall) {
      const created = createRunRow({
        triggerId: null,
        workspaceId: session.workspaceId ?? null,
        executionId: session.executionId ?? null,
        chatSessionId,
        agentId: session.agentId,
        triggerKind: 'manual',
        triggerPayload: null,
        scheduledFor: null,
        status: 'queued',
      });
      markRunStartedRow(created.id);
      beginRun(created.id, chatSessionId);
      manualRun = { runId: created.id, ownsLifecycle: true };
    }

    const agentSession = await ensureAgentSession({
      chatSessionId,
      harness: agent.harness,
      cwd,
      sessionType: session.type,
      workspaceId: session.workspaceId ?? null,
      surfaceKind: session.surfaceKind,
      surfaceRef: session.surfaceRef,
      existingExternalSessionId: session.externalSessionId,
      permissionMode: session.permissionMode,
      model: selection.model,
      modelVariant: selection.variant,
      effort: selection.effort,
      writer,
    });
    const { result } = await agentSession.send(userMessage);
    await result;
    if (manualRun?.ownsLifecycle) {
      markRunCompletedRow(manualRun.runId);
      void notifyRunTerminal(manualRun.runId).catch(() => {});
    }
  } catch (err) {
    if (manualRun?.ownsLifecycle) {
      markRunFailedRow(manualRun.runId, {
        errorCode: 'agent_error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
      void notifyRunTerminal(manualRun.runId).catch(() => {});
      // Touch the chat's outcome timestamp so a failure before any
      // assistant turn still surfaces in the inbox. Without this, a
      // turn that throws inside `ensureAgentSession` / the first
      // `send` would leave the chat invisibly stuck — the unread
      // derivation only ticks on `agent` / `result` events written
      // through the event writer.
      try { bumpSessionOutcome(chatSessionId); } catch { /* best-effort */ }
    }
    throw err;
  } finally {
    _endActiveDispatch(chatSessionId, activeDispatchRef);
    if (manualRun?.ownsLifecycle) {
      endRun(manualRun.runId, chatSessionId);
    }
  }
}

/**
 * Interrupt the current turn for a chat_session, if any. The agent
 * receives SIGTERM / equivalent and the in-flight `send()` promise
 * resolves (typically with a `result` event flagged as aborted).
 */
export async function abort(chatSessionId: string): Promise<void> {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return;
  await handle.interrupt();
}

/**
 * Stop a single background task (a backgrounded shell/server or async subagent)
 * without disturbing the session or its other tasks. Forwards to the live
 * `AgentSession.stopTask` (agentex 0.0.22+), which sends the CLI's `stop_task`
 * control request; the harness owns the process and performs the kill, so the
 * model isn't involved. Returns `{ stopped: false }` when there's no live
 * session, the provider lacks per-task stop (`capabilities.stopTask === false`),
 * or the task is unknown / already ended. The task's next lifecycle event
 * (`task_updated`/`task_notification`) reflects the kill.
 */
export async function stopTask(
  chatSessionId: string,
  taskId: string,
): Promise<{ stopped: boolean }> {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return { stopped: false };
  return handle.stopTask(taskId);
}

/**
 * Tear down the cached AgentSession for a chat_session — used when we
 * archive the chat_session or want to force resume on next dispatch.
 */
export async function close(chatSessionId: string): Promise<void> {
  const handle = agentSessions.get(chatSessionId);
  agentSessions.delete(chatSessionId);
  sessionInventories.delete(chatSessionId);
  advanceDispatchGeneration(chatSessionId);
  inflightCount.delete(chatSessionId);
  activeDispatchCount.delete(chatSessionId);
  setRunning(chatSessionId, false);
  clearBackgroundTasks(chatSessionId);
  clearReferenceFolderInstructions(chatSessionId);
  rejectAllForSession(chatSessionId, 'Session closed');
  if (handle) {
    try { await handle.close(); } catch { /* best-effort */ }
  }
}

/**
 * Recycle every live agent session for a workspace (spec §6f). Called after a workspace's connector
 * scopes change so a removed service takes effect immediately rather than next session — the harness
 * caches its tool list otherwise. A no-op for sessions that aren't currently live.
 */
export async function recycleWorkspaceSessions(workspaceId: string): Promise<void> {
  // Only execution sessions consume the workspace connector scope (the orchestrator + content
  // sessions stay broad), so only those need recycling — don't disturb live content/focused sessions.
  const sessions = listChatSessions({ workspaceId, status: 'active', type: 'execution' });
  await Promise.all(sessions.map((s) => recycleForModeChange(s.id)));
}

/**
 * Recycle live sessions after a reference folder changes, so an added or
 * removed folder takes effect now rather than whenever the session happens to
 * restart. Session config (`instructionsFile`, `--add-dir`, the deny rules) is
 * fixed at spawn, so without this the running agent keeps the old list
 * indefinitely — the same problem connector scopes solve via
 * `recycleWorkspaceSessions`.
 *
 * A global reference (`workspaceId === null`) is visible everywhere, so it has
 * to recycle every workspace's execution sessions, not just one.
 */
export async function recycleForReferenceFolderChange(
  workspaceId: string | null,
): Promise<void> {
  if (workspaceId) return recycleWorkspaceSessions(workspaceId);
  const sessions = listChatSessions({ status: 'active', type: 'execution' });
  await Promise.all(sessions.map((s) => recycleForModeChange(s.id)));
}

/**
 * Close every app-cached session for one harness after its credential store
 * changes. Agentex retires its runtime generation, while this clears handles
 * that captured the old environment or retired OpenCode server.
 */
export async function recycleHarnessSessions(harness: ProviderId): Promise<void> {
  const affected: string[] = [];
  for (const sessionId of agentSessions.keys()) {
    const session = getChatSession(sessionId);
    const agent = session ? getAgent(session.agentId) : null;
    if (!agent) continue;
    try {
      if (providerIdForHarness(agent.harness) === harness) affected.push(sessionId);
    } catch {
      // Unknown historical harness rows are unrelated to this credential.
    }
  }
  await Promise.all(affected.map((sessionId) => close(sessionId)));
}

/**
 * Drop the cached AgentSession without closing pending requests. Used when
 * selection changes require the next dispatch to spawn a fresh CLI process
 * and resume the conversation through `externalSessionId`.
 *
 * Best-effort close on the existing handle. Selection-changing routes reject
 * changes during an active turn before reaching this function. Other callers
 * use it for lifecycle invalidation where closing the old handle is expected.
 */
export async function recycleForModeChange(chatSessionId: string): Promise<void> {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return;
  agentSessions.delete(chatSessionId);
  // Drop the inventory too — the recycled session will emit a fresh
  // system/init with potentially different available skills (e.g. plan
  // mode restricts the toolset).
  sessionInventories.delete(chatSessionId);
  clearBackgroundTasks(chatSessionId);
  // Don't reject pending requests — a mode change shouldn't blow up
  // an in-flight permission prompt the user is about to answer.
  try { await handle.close(); } catch { /* best-effort */ }
}

// ─── Internal: agent session lifecycle ────────────────────────

interface EnsureArgs {
  chatSessionId: string;
  harness: string;
  cwd: string;
  /** chat_sessions.type — orchestration sessions get the data-root surface. */
  sessionType: 'orchestration' | 'content' | 'execution';
  /** The session's workspace (for execution connector scoping); null for workspace-less. */
  workspaceId: string | null;
  /**
   * For `content` sessions: the entity the in-document chat is focused on
   * (`surfaceKind` = 'task' | 'note', `surfaceRef` = its id). Null for other
   * session types. Drives the per-session focus directive.
   */
  surfaceKind: string | null;
  surfaceRef: string | null;
  existingExternalSessionId: string | null;
  permissionMode: PermissionMode;
  model: string | null;
  modelVariant: string | null;
  effort: EffortLevel | null;
  writer: EventWriter;
}

/**
 * Which orchestrator surface an orchestration-type session gets. The
 * dashboard toggle (`user_state.orchestratorMode`) wins when it names a
 * harness mode; `legacy` (the hand-rolled chat agent) still needs scheduled
 * orchestrator fires to work, and those are harness sessions by
 * construction — they default to the MCP surface, the most robust path.
 */
function resolveOrchestratorMode(): Exclude<OrchestratorMode, 'legacy'> {
  const mode = getUserState()?.orchestratorMode;
  return mode === 'harness_skills' || mode === 'harness_mcp' ? mode : 'harness_mcp';
}

async function ensureAgentSession(args: EnsureArgs): Promise<AgentSession> {
  const cached = agentSessions.get(args.chatSessionId);
  if (cached) {
    if (isAgentSessionAlive(args.chatSessionId)) return cached;
    // Stale corpse: the SDK or our liveness probe knows the subprocess
    // is gone. Drop it and fall through to a fresh spawn. The previous
    // ensureAgentSession returned dead handles unconditionally, which
    // produced silent "Session is closed" throws on the very next send.
    invalidateAgentSession(args.chatSessionId);
  }

  const providerType = mapHarnessToProvider(args.harness);
  const provider = getProvider(providerType);
  if (!provider.createSession) {
    throw new ExecutorError(
      'unsupported',
      `Provider "${providerType}" does not implement multi-turn createSession`,
    );
  }

  // Build the agentex ProviderConfig from session-level overrides. Each
  // field falls back to the harness default when unset, so a fresh
  // session with all-null overrides produces no extra CLI flags.
  const harness = providerIdForHarness(args.harness);
  const [runtimeContext, runtime] = await Promise.all([
    runtimeContextForHarness(harness, { cwd: args.cwd }),
    getHarnessRuntime(harness, { cwd: args.cwd }),
  ]);
  if (!runtime.capabilities.sessions.supported) {
    throw new ExecutorError(
      'unsupported',
      runtime.capabilities.sessions.reason ?? `${providerType} sessions are unavailable`,
    );
  }
  const claudeMode = providerType === 'claude' && args.permissionMode !== 'plan'
    ? claudePermissionFlag(args.permissionMode)
    : null;
  const config: ProviderConfig = {
    ...runtimeContext.config,
    unattendedPermissionPolicy: 'deny',
    ...(args.permissionMode === 'bypass' ? { skipPermissions: true } : {}),
  };
  const extraArgs: string[] = [];
  if (claudeMode) extraArgs.push('--permission-mode', claudeMode);
  if (args.model) config.model = args.model;
  if (args.modelVariant && runtime.capabilities.modelVariants.supported) {
    config.modelVariant = args.modelVariant;
  }
  // Canonical id straight through. agentex owns the per-provider vocabulary
  // (Claude spells the top rung `ultracode`, Codex spells it `ultra`) and
  // translates at the flag boundary, so translating here too would be a second
  // source of truth for the same fact.
  if (args.effort && runtime.capabilities.reasoningEffort.supported) {
    config.effort = args.effort;
  }
  if (args.permissionMode === 'plan' && runtime.capabilities.planMode.supported) {
    config.planMode = true;
  }

  // Orchestration sessions run in the app data root and act through the
  // typed action surface. Install/refresh the on-disk brief (CLAUDE.md /
  // AGENTS.md) before spawn — this also `ensureAppRoot()`s the cwd — and
  // merge the mode's typed ProviderConfig slice (disallowedTools /
  // strictMcpConfig / mcpServers, agentex ≥0.0.20). Providers without
  // tool-filtering or MCP wiring ignore the fields (Codex today), so the
  // config is safe to pass everywhere — but warn, because the write guard
  // genuinely doesn't hold there yet.
  if (args.sessionType === 'orchestration' || args.sessionType === 'content') {
    const orchestratorMode = resolveOrchestratorMode();
    try {
      await installOrchestratorSurface(orchestratorMode);
      Object.assign(config, orchestratorSessionConfig(orchestratorMode));
      // A `content` session is a *focused* orchestrator session: same
      // installed surface + tool set, narrowed to the one task/note the user
      // is viewing in the editor. The focus rides Claude's
      // --append-system-prompt so it never shows in the transcript; other
      // providers run the un-focused surface (the brief + the user's own
      // messages still keep them on-task — no write guard either way there).
      if (
        args.sessionType === 'content' &&
        providerType === 'claude' &&
        (args.surfaceKind === 'task' || args.surfaceKind === 'note') &&
        args.surfaceRef
      ) {
        extraArgs.push(
          '--append-system-prompt',
          renderContentFocusPrompt({ entityType: args.surfaceKind, entityId: args.surfaceRef }),
        );
      }
      if (providerType !== 'claude') {
        console.warn(
          `[executor] ${args.sessionType} session on provider "${providerType}": surface installed, ` +
            'but tool filtering / MCP attachment are ignored by this provider (no write guard).',
        );
      }
    } catch (err) {
      // A failed surface install shouldn't kill the turn — the session
      // still runs against whatever brief is already on disk.
      console.error('[executor] orchestrator surface install failed:', err);
    }
  }

  // Execution (workspace coding/agent) sessions: fail closed on MCP, and attach the
  // workspace-scoped connectors endpoint when the workspace opted in — but ONLY on a harness that
  // actually enforces strict MCP (Claude Code today; Codex ignores these fields). See spec §3/§6c.
  if (args.sessionType === 'execution') {
    if (runtime.capabilities.strictMcpIsolation.supported) {
      config.strictMcpConfig = true; // no ambient/user/repo MCP leaks into the worktree agent
      const scopes = args.workspaceId ? getWorkspace(args.workspaceId)?.connectorScopes ?? [] : [];
      if (scopes.length > 0 && args.workspaceId) {
        const server = connectorsMcpServer(undefined, { workspaceId: args.workspaceId });
        if (server) config.mcpServers = [server];
      }
    } else {
      const wantsConnectors = args.workspaceId
        ? (getWorkspace(args.workspaceId)?.connectorScopes.length ?? 0) > 0
        : false;
      if (wantsConnectors) {
        console.warn(
          `[executor] execution on provider "${providerType}": connectors are unavailable ` +
            '(this harness does not enforce strict MCP tool-filtering).',
        );
      }
    }

    // Reference folders (docs/reference-folders-spec.md §6/§7). The prompt
    // block is the feature — the agent can already read any absolute path, it
    // just never knows the folder is there. Delivered via `instructionsFile`
    // because every provider resolves that, unlike the claude-only
    // `--append-system-prompt` used by the content branch above.
    //
    // `--add-dir` and the Edit deny rules are claude-only argv, so they're
    // gated. Broken references are dropped upstream by
    // `listUsableReferenceFolders` — pointing an agent at a path that isn't
    // there is worse than saying nothing.
    try {
      const workspaceCwd = args.workspaceId ? getWorkspace(args.workspaceId)?.cwd ?? null : null;
      const refs = await listUsableReferenceFolders(args.workspaceId ?? null, {
        consumerCwd: workspaceCwd,
      });
      const refConfig = buildReferenceFolderSessionConfig(refs);
      if (refConfig.instructions) {
        const wiring = referenceFolderProviderWiring(refConfig, providerType);
        if (wiring.deliversInstructions) {
          config.instructionsFile = writeReferenceFolderInstructions(
            args.chatSessionId,
            refConfig.instructions,
          );
        }
        extraArgs.push(...wiring.extraArgs);
        if (wiring.disallowedTools.length > 0) {
          config.disallowedTools = [...(config.disallowedTools ?? []), ...wiring.disallowedTools];
        }
        if (wiring.delivery === 'prompt-only') {
          console.warn(
            `[executor] execution on provider "${providerType}": ${refs.length} reference folder(s) ` +
              'announced in the prompt, but the read scope and edit deny rules are claude-only argv ' +
              '(this provider is told about them without being fenced off).',
          );
        } else if (wiring.delivery === 'unsupported') {
          // Not a partial degradation — a total one. This provider's session
          // path drops `instructionsFile`, so the agent is never told the
          // folders exist, which is the whole feature.
          console.warn(
            `[executor] execution on provider "${providerType}": ${refs.length} reference folder(s) ` +
              'configured but NOT delivered — this harness ignores session-scoped instructions, ' +
              'so the agent will not be told these folders exist. Use claude or codex for reference folders.',
          );
        }
      }
    } catch (err) {
      // A reference-folder failure must never cost the user their session.
      console.error('[executor] reference folder resolution failed:', err);
    }
  }

  if (extraArgs.length > 0) config.extraArgs = extraArgs;

  // Shipped skills are discovered from the app root or the user's explicit
  // global install. Never pass them through skillDirs here. The Codex provider
  // materializes configured skillDirs inside the project, which previously
  // left an app-owned .agents/skills/orchestrator symlink in every workspace.
  // Clean that legacy link only when it points to our shipped skill.
  if (args.sessionType === 'execution') {
    try {
      const cleanup = await removeOwnedProjectSkillLinks(args.cwd);
      if (cleanup.entries.some((entry) => entry.status === 'error')) {
        console.warn('[executor] failed to clean one or more legacy project skill links');
      }
    } catch (err) {
      console.warn('[executor] failed to clean legacy project skill links:', err);
    }
  }

  // Layer in author-neutral user-skill paths:
  //   - Global: <brain>/skills/<name>/SKILL.md
  //   - Workspace: <workspace>/.flow/skills/<name>/SKILL.md (workspace wins
  //     on name collision). See src/lib/executor/skills.ts.
  const skillDirs = resolveSkillDirsForSession(args.cwd);
  if (skillDirs.length > 0) config.skillDirs = skillDirs;

  const handle = await provider.createSession({
    cwd: args.cwd,
    env: runtimeContext.env,
    sessionParams: args.existingExternalSessionId
      ? { sessionId: args.existingExternalSessionId }
      : undefined,
    config: Object.keys(config).length > 0 ? config : undefined,
    onUserInputRequest: (req) => handleUserInputRequest(args.chatSessionId, args.writer, req),
    onEvent: async (event) => {
      try {
        const safeEvent = redactAgentRuntimeValue(event);
        _recordSessionInventory(args.chatSessionId, safeEvent);
        await persistStreamEvent(args.chatSessionId, safeEvent, args.writer, {
          trackBackgroundTaskRuntime: true,
        });
        capturePromotedSessionId(args.chatSessionId, safeEvent);
        // Run telemetry: cost capture (#13), artifact accumulation (#14),
        // summary extraction (#15). No-op when there's no active run
        // registered for this chat — the manual-dispatch path registers
        // one before sending, scheduled dispatches do it via the
        // dispatcher wrapper.
        await handleRunStreamEventSafe(args.chatSessionId, safeEvent);
      } catch (err) {
        // One bad event shouldn't crash the whole turn — log and keep going.
        console.error(`[executor] failed to persist event for ${args.chatSessionId}:`, err);
      }
    },
  });

  // Service-backed providers can assign their session id before emitting any
  // stream event. Persist it immediately so a host crash during the first turn
  // still leaves enough identity for durable history recovery.
  const record = handle.describeHistory?.() ?? handle.describe?.();
  const promotedId = typeof record?.params.sessionId === 'string' ? record.params.sessionId : handle.sessionId;
  if (promotedId) updateChatSession(args.chatSessionId, { externalSessionId: promotedId });

  agentSessions.set(args.chatSessionId, handle);
  return handle;
}

/**
 * Map our internal permission mode to Claude's `--permission-mode` flag
 * value. Returns null for `bypass` — we don't pass the flag and the
 * callback below auto-allows everything (matches the legacy behavior
 * where Flow never prompted).
 */
function claudePermissionFlag(mode: PermissionMode): string | null {
  switch (mode) {
    case 'bypass': return null;
    case 'default': return 'default';
    case 'accept_edits': return 'acceptEdits';
    case 'plan': return 'plan';
  }
}

/**
 * Translate an agentex tool-permission request into pending-input state +
 * a transcript event, then await the user's answer. Called once per tool
 * call that needs approval (every mutating tool in default mode, Bash in
 * accept_edits mode, etc.) and once per AskUserQuestion.
 *
 * In `bypass` mode we short-circuit. The current chat_session row is
 * read fresh each time so a mid-conversation mode change takes effect on
 * the next prompt without restarting the CLI.
 */
async function handleUserInputRequest(
  chatSessionId: string,
  writer: EventWriter,
  req: UserInputRequest,
): Promise<UserInputResponse> {
  const session = getChatSession(chatSessionId);
  const mode: PermissionMode = session?.permissionMode ?? 'bypass';

  const pending = classifyRequest(chatSessionId, req);

  // Bypass: only AskUserQuestion still needs UI. Auto-allowing a question
  // returns empty answers to Claude and the agent stalls — surface it.
  //
  // updatedInput must be present on every allow response. Claude's
  // PermissionAllowResultSchema requires it as a record; an empty object
  // is treated as "use original input" but the field still has to exist.
  // Without it Claude raises a Zod error and the tool call fails as if
  // we'd denied — except the agent reads it as a tool failure and retries.
  if (mode === 'bypass' && pending.kind === 'permission') {
    return { allow: true, updatedInput: req.input };
  }

  // Persist a transcript row so the request is visible in chat history
  // (alongside the live overlay). Idempotent — if the same toolUseId
  // shows up twice (retry), the unique index drops the duplicate.
  try {
    await writer.write(buildPendingRequestEvent(chatSessionId, pending));
  } catch (err) {
    console.error(`[executor] failed to persist pending event for ${chatSessionId}:`, err);
  }

  // Notifier (best-effort): the agent is blocked on the human — fire off the durable request (§2.4).
  void notifyNeedsInput({
    sessionId: chatSessionId,
    requestId: pending.requestId,
    title: pending.kind === 'permission' ? `Permission: ${pending.toolName}` : 'Agent has a question',
    body:
      pending.kind === 'permission'
        ? pending.title ?? pending.description ?? 'The agent needs permission to continue.'
        : 'The agent is waiting for your answer.',
  }).catch(() => {});

  const response = await registerPending(pending);

  try {
    await writer.write(buildPendingResponseEvent(chatSessionId, pending, response));
  } catch (err) {
    console.error(`[executor] failed to persist response event for ${chatSessionId}:`, err);
  }

  // Auto-revert plan mode on ExitPlanMode allow. Claude transitions
  // its own internal mode when the tool call succeeds; we mirror that
  // in our session row so the UI flips back to whatever the user had
  // before plan (or `bypass` if they came in fresh). No CLI recycle
  // needed — the running process already exited plan internally; we
  // just want subsequent renders + future recycles to show the new
  // mode.
  if (
    pending.kind === 'permission' &&
    pending.toolName === 'ExitPlanMode' &&
    response.allow
  ) {
    revertFromPlanMode(chatSessionId);
  }

  return response;
}

function revertFromPlanMode(chatSessionId: string): void {
  const session = getChatSession(chatSessionId);
  if (!session || session.permissionMode !== 'plan') return;
  const target: PermissionMode = (session.prePlanMode as PermissionMode | null) ?? 'bypass';
  try {
    updateChatSession(chatSessionId, {
      permissionMode: target,
      prePlanMode: null,
    });
  } catch (err) {
    console.error(`[executor] failed to revert plan mode for ${chatSessionId}:`, err);
  }
}

function buildPendingRequestEvent(
  chatSessionId: string,
  pending: PendingInput,
): CreateChatEventInput {
  const base = {
    sessionId: chatSessionId,
    externalEventId: uuidv7(),
    externalToolCallId: pending.toolUseId,
    role: 'system',
    createdAt: pending.createdAt,
  };
  if (pending.kind === 'question') {
    return {
      ...base,
      source: 'question_request' satisfies ChatEventSource,
      content: null,
      toolInput: { questions: pending.questions } as Record<string, unknown>,
      raw: { kind: 'question', questions: pending.questions },
    };
  }
  return {
    ...base,
    source: 'permission_request' satisfies ChatEventSource,
    content: pending.title ?? pending.description ?? null,
    toolName: pending.toolName,
    toolInput: pending.input,
    raw: {
      kind: 'permission',
      title: pending.title,
      description: pending.description,
    },
  };
}

function buildPendingResponseEvent(
  chatSessionId: string,
  pending: PendingInput,
  response: UserInputResponse,
): CreateChatEventInput {
  const base = {
    sessionId: chatSessionId,
    externalEventId: uuidv7(),
    externalToolCallId: pending.toolUseId,
    role: 'system',
    createdAt: new Date().toISOString(),
  };
  if (pending.kind === 'question') {
    const answers = (response.updatedInput?.answers ?? null) as Record<string, string> | null;
    return {
      ...base,
      source: 'question_response' satisfies ChatEventSource,
      content: answers ? formatAnswerSummary(answers) : 'declined',
      toolInput: { answers, allow: response.allow } as Record<string, unknown>,
      raw: { allow: response.allow, answers },
    };
  }
  return {
    ...base,
    source: 'permission_response' satisfies ChatEventSource,
    content: response.allow ? 'allowed' : (response.message ?? 'denied'),
    toolName: pending.toolName,
    toolIsError: !response.allow,
    raw: {
      allow: response.allow,
      message: response.message ?? null,
    },
  };
}

function formatAnswerSummary(answers: Record<string, string>): string {
  return Object.entries(answers).map(([q, a]) => `${q}: ${a}`).join('\n');
}

/** Render a rate_limit event's content as a human sentence. */
function formatRateLimitContent(
  status: string,
  limitType: string | null,
  resetAt: string | null,
): string {
  // limitType comes through as snake_case (e.g. `five_hour`,
  // `monthly_overage`). Surface it humanized.
  const window = limitType ? limitType.replace(/_/g, ' ') : null;
  const resetTime = resetAt ? formatResetTime(resetAt) : null;
  const lead = status === 'exceeded'
    ? 'Rate limit hit'
    : status === 'blocked'
      ? 'Request blocked'
      : `Rate limit (${status})`;
  const parts = [lead, window ? `· ${window}` : null, resetTime ? `· resets ${resetTime}` : null];
  return parts.filter(Boolean).join(' ');
}

function formatResetTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  // Local time, no seconds. e.g. "10:30 PM" or "Mon 10:30 PM" if not today.
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const time = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (sameDay) return time;
  const day = date.toLocaleDateString(undefined, { weekday: 'short' });
  return `${day} ${time}`;
}

/**
 * Claude Code (and most providers) emit a `system` event near the start
 * of a session whose `sessionId` is the CLI's own session id. Capture it
 * the first time we see it and write it back to the chat_session row so
 * future resumes work.
 */
function capturePromotedSessionId(chatSessionId: string, event: StreamEvent): void {
  if (!event.sessionId) return;
  const session = getChatSession(chatSessionId);
  if (!session || session.externalSessionId === event.sessionId) return;
  updateChatSession(chatSessionId, { externalSessionId: event.sessionId });
}

// ─── Stream event → chat_events row ───────────────────────────

/**
 * Defensive wrapper around the run-telemetry hook. Captures tool-call
 * names as they pass through (so a later `tool_result` can be
 * attributed to a mutating action), then defers to `handleRunStreamEvent`
 * for cost + artifact + summary accumulation. Errors are swallowed —
 * dropping a telemetry event is preferable to losing the user's turn.
 */
async function handleRunStreamEventSafe(
  chatSessionId: string,
  event: StreamEvent,
): Promise<void> {
  try {
    if (event.type === 'tool_call' && event.toolCallId) {
      registerToolCallName(event.toolCallId, event.name);
    }
    await handleRunStreamEvent(chatSessionId, event);
  } catch (err) {
    console.warn(`[runs] telemetry hook failed for ${chatSessionId}:`, err);
  }
}

export async function persistStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
  writer: EventWriter = localEventWriter,
  options: { trackBackgroundTaskRuntime?: boolean } = {},
): Promise<void> {
  const safeEvent = redactAgentRuntimeValue(event);
  const row = parseStreamEvent(chatSessionId, safeEvent);
  if (!row) return;
  const cumulativeOpenCodePart = safeEvent.providerType === 'opencode'
    && Boolean(safeEvent.eventId)
    && (safeEvent.type === 'assistant' || safeEvent.type === 'thinking');
  try {
    if (cumulativeOpenCodePart && writer.replacePart) await writer.replacePart(row);
    else await writer.write(row);
  } finally {
    // Durable transcript replay shares this persistence path but must never
    // mutate ephemeral runtime state. It can interleave with a live provider
    // callback and otherwise replay an older start after a newer terminal edge.
    if (options.trackBackgroundTaskRuntime) {
      _recordBackgroundTaskEvent(chatSessionId, safeEvent);
    }
  }
}

/**
 * Map an agentex `StreamEvent` to a `chat_events` insert input. See the
 * mapping table in `docs/executor-wiring-spec.md` for the full
 * source-discriminator semantics.
 *
 * `externalEventId` is the provider's wire-level event id when present
 * (Claude exposes a stable uuid per event; Codex doesn't). Using the wire
 * id means a row written via the live stream and the same row re-derived
 * during a JSONL replay collide on the partial unique index — replay is
 * idempotent at the DB level without us having to track anything extra.
 * When the provider doesn't surface an id, we mint a uuidv7 so the row
 * still has a stable identifier; replay-dedup for those providers falls
 * back to byte-offset cursoring.
 */
export function parseStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
): CreateChatEventInput | null {
  const externalEventId = event.eventId ?? uuidv7();
  const createdAt = event.timestamp || new Date().toISOString();
  const isOpenCodePart = event.providerType === 'opencode' && Boolean(event.eventId);
  const cumulativeText = isOpenCodePart
    && event.raw
    && typeof event.raw === 'object'
    && typeof (event.raw as Record<string, unknown>).text === 'string'
    ? (event.raw as Record<string, unknown>).text as string
    : null;
  const base = {
    sessionId: chatSessionId,
    externalEventId: externalEventId,
    raw: event as unknown as Record<string, unknown>,
    createdAt,
    ...(isOpenCodePart ? { sourcePartIndex: event.type === 'tool_result' ? 1 : 0 } : {}),
  };

  // Agentex 0.0.33+ lifecycle metadata. Active updates stay as filtered system
  // rows. Terminal updates become compact, visible outcomes so a detached
  // child's summary remains discoverable and reaches Needs Review.
  if ((event as { type: string }).type === 'background_task') {
    const backgroundTask = decodeBackgroundTaskEvent(event);
    const terminal = backgroundTask !== null && !isActiveBackgroundTaskEvent(backgroundTask);
    return {
      ...base,
      role: 'system',
      source: (terminal ? 'background_task' : 'system') satisfies ChatEventSource,
      content: terminal
        ? backgroundTask.summary
          ?? backgroundTask.description
          ?? 'Background task finished'
        : 'background_task',
      ...(terminal ? { toolIsError: backgroundTask.status === 'failed' } : {}),
    };
  }

  switch (event.type) {
    case 'system':
      return {
        ...base,
        role: 'system',
        source: 'system' satisfies ChatEventSource,
        content: event.subtype ?? null,
      };
    case 'assistant':
      return {
        ...base,
        role: 'assistant',
        source: 'agent' satisfies ChatEventSource,
        content: cumulativeText ?? event.text ?? null,
      };
    case 'thinking':
      return {
        ...base,
        role: 'assistant',
        source: 'thinking' satisfies ChatEventSource,
        content: cumulativeText ?? event.text ?? null,
      };
    case 'tool_call':
      return {
        ...base,
        role: 'assistant',
        source: 'tool_call' satisfies ChatEventSource,
        content: null,
        toolName: event.name,
        toolInput: (event.input ?? null) as Record<string, unknown> | null,
        externalToolCallId: event.toolCallId ?? null,
      };
    case 'tool_result':
      return {
        ...base,
        role: 'tool',
        source: 'tool_result' satisfies ChatEventSource,
        content: event.content ?? null,
        toolIsError: event.isError ?? false,
        externalToolCallId: event.toolCallId ?? null,
      };
    case 'result':
      // Claude packs the final agent message text into `event.result`,
      // which would duplicate the trailing `assistant` row's content if
      // we surfaced it. Keep the row for turn-boundary tracking + the
      // rich metadata (cost, usage, stopReason, terminalReason) in
      // `raw`, but don't render text. The UI filters this source out
      // of the transcript entirely — the composer re-enabling is the
      // visible "turn complete" signal.
      return {
        ...base,
        role: 'system',
        source: 'result' satisfies ChatEventSource,
        content: null,
        toolIsError: event.isError ?? false,
      };
    case 'auth_required': {
      // Provider can't reach its API because the user isn't authenticated
      // (OAuth expired, revoked, missing, scope, or disabled org). Surface
      // as its own chat_event source so the renderer can show an inline
      // "Log in" button rather than a generic red error pill. Recovery is
      // out-of-band via `claude auth login` — see /api/claude-auth/login.
      return {
        ...base,
        role: 'system',
        source: 'auth_required' satisfies ChatEventSource,
        content: event.message ?? 'Claude needs to log in again',
        toolInput: {
          httpStatus: event.httpStatus,
          reason: event.reason,
          loginCommand: event.loginCommand,
          providerType: event.providerType,
        } as Record<string, unknown>,
      };
    }
    case 'rate_limit': {
      // Claude emits rate_limit events on every turn with the current
      // window status. Only surface actual throttling — the user
      // doesn't want a transcript pill for "you have quota" or "you're
      // approaching the limit." The whitelist below is intentionally
      // narrow: anything we haven't seen before drops too, on the
      // theory that an unfamiliar status is more likely to be benign
      // than a missed real-throttle event.
      const ev = event as { status?: string; limitType?: string | null; resetAt?: string | null };
      const status = (ev.status ?? '').toLowerCase();
      const isThrottle =
        status === 'exceeded' ||
        status === 'blocked' ||
        status === 'limited' ||
        status === 'throttled';
      if (!isThrottle) return null;
      const friendly = formatRateLimitContent(status, ev.limitType ?? null, ev.resetAt ?? null);
      return {
        ...base,
        role: 'system',
        source: 'rate_limit' satisfies ChatEventSource,
        content: friendly,
      };
    }
    case 'unknown':
      return mapUnknownEvent(chatSessionId, event, externalEventId, createdAt);
    default: {
      // True forward-compat: a type we don't know about at all (not even
      // agentex's `unknown`). Persist with the type as content so the
      // user sees something readable.
      const fallback = event as { type?: string; timestamp?: string };
      return {
        sessionId: chatSessionId,
        externalEventId: externalEventId,
        role: 'system',
        source: 'unknown' satisfies ChatEventSource,
        content: fallback.type ?? null,
        raw: event as unknown as Record<string, unknown>,
        createdAt: fallback.timestamp ?? new Date().toISOString(),
      };
    }
  }
}

/**
 * Map an agentex `unknown` StreamEvent to the right chat_events source.
 *
 * The agentex `unknown` type is its forward-compat fallback for provider
 * events it doesn't model first-class. The provider's outer event name
 * is in `event.subtype`; for Claude, the meaningful Claude-specific
 * subtype is in `raw.subtype`.
 *
 * Most Claude unknowns we care about:
 *   - `compact_boundary`  → conversation context was compacted; show as
 *                            recap so the existing recap divider renders.
 *   - `api_error`         → API-level error; show as error.
 *   - `turn_duration`     → timing telemetry; drop entirely.
 *   - `away_summary`      → resume summary; show as system divider with content.
 *   - `bridge_status`     → MCP / connection status; show as system divider.
 *
 * Claude JSONL-only bookkeeping types (`ai-title`, `last-prompt`,
 * `attachment`, `progress`) never appear on stdout — only on disk.
 * They reach us exclusively through the transcript reconciler and
 * carry no transcript-worthy content (titles are UI metadata, the
 * last-prompt mirror is already covered by the `user` event, etc.).
 * Drop them outright.
 *
 * Anything we don't recognize keeps the `unknown` source but gains a
 * descriptive content string so the transcript no longer shows a bare
 * "[unknown]" line.
 */
const CLAUDE_DISK_ONLY_NOISE: ReadonlySet<string> = new Set([
  'ai-title',
  'last-prompt',
  'attachment',
  'progress',
]);


function mapUnknownEvent(
  chatSessionId: string,
  event: StreamEvent,
  externalEventId: string,
  createdAt: string,
): CreateChatEventInput | null {
  const ev = event as { subtype?: string; raw?: Record<string, unknown> };
  const claudeSubtype = typeof ev.raw?.['subtype'] === 'string' ? (ev.raw['subtype'] as string) : null;
  const codexMethod = typeof ev.raw?.['method'] === 'string' ? (ev.raw['method'] as string) : null;
  // Prefer Claude's inner subtype, then Codex's JSON-RPC method, then
  // agentex's outer subtype as a last resort.
  const subtype = claudeSubtype ?? codexMethod ?? ev.subtype ?? null;
  const rawContent = typeof ev.raw?.['content'] === 'string' ? (ev.raw['content'] as string) : null;

  const base = {
    sessionId: chatSessionId,
    externalEventId: externalEventId,
    raw: event as unknown as Record<string, unknown>,
    createdAt,
  };

  // Drop Claude's JSONL-only bookkeeping types up front. These never
  // appear in the live stream; they only reach us via the transcript
  // reconciler and carry no transcript-worthy content.
  if (subtype !== null && CLAUDE_DISK_ONLY_NOISE.has(subtype)) {
    return null;
  }

  switch (subtype) {
    case 'compact_boundary':
      return {
        ...base,
        role: 'system',
        source: 'recap' satisfies ChatEventSource,
        content: 'Context compacted',
      };
    case 'api_error':
      return {
        ...base,
        role: 'system',
        source: 'error' satisfies ChatEventSource,
        content: rawContent ?? 'API error',
      };
    case 'turn_duration':
      // Pure telemetry — never useful in the transcript.
      return null;
    case 'away_summary':
    case 'bridge_status':
    case null:
      return {
        ...base,
        role: 'system',
        source: 'system' satisfies ChatEventSource,
        content: rawContent ?? subtype ?? null,
      };
    default:
      // Unknown subtype: still surface as system rather than the
      // misleading "[unknown]" pill. Content carries the subtype so a
      // human can spot what's coming through.
      return {
        ...base,
        role: 'system',
        source: 'system' satisfies ChatEventSource,
        content: subtype,
      };
  }
}

// ─── Helpers ──────────────────────────────────────────────────

/**
 * For git workspaces: the worktree path. For non-git: the workspace's
 * cwd directly. Returns null if the chat_session has no workspace.
 *
 * `worktreePath` lives on the execution now, so callers pass a flattened
 * `getChatSessionWithExecution` row (or anything structurally carrying the
 * two fields). Accepting it structurally keeps this compiling after the
 * legacy chat_sessions columns are dropped.
 *
 * Stale-path guard: an execution row can outlive its worktree (archive
 * teardown, manual `git worktree remove`/`prune`, dev resets, a
 * multi-device home where `.work` wasn't synced, reconciler running
 * offline). Auto-resume-on-view handles the click-archived-chat case by
 * nulling `worktreePath` before re-provision, but dispatch/reconcile can
 * still see stale paths in the other scenarios.
 *
 * Critically, for a GIT workspace we must NOT fall through to the
 * workspace's source checkout when the worktree is missing. The worktree
 * is the unit of per-execution isolation; running the agent in `ws.cwd`
 * instead means it reads, edits, and commits in the user's main tree on
 * whatever branch happens to be checked out there. We return null so the
 * caller fails loud (`dispatch` throws `invalid_state`, `reconcile` skips
 * with `no_cwd`) or, better, reprovisions first (`ensureWorktreeReady`,
 * which the scheduled path and the message route both run before
 * dispatch). The `ws.cwd` fallback is correct only for NON-git workspaces,
 * which have no worktree concept. (Live mode keeps `worktreePath ===
 * ws.cwd`, so the existence check above already returns it.)
 */
export function resolveCwd(session: { worktreePath: string | null; workspaceId: string | null }): string | null {
  if (session.worktreePath && existsSync(session.worktreePath)) return session.worktreePath;
  if (!session.workspaceId) {
    // No workspace → the session runs in the app data root. This is the
    // orchestrator/content path: interactive orchestrator chats and
    // scheduled `targetKind='orchestrator'` fires both land here (the
    // latter previously dead-ended with "no resolvable cwd"). The
    // orchestrator branch in `ensureAgentSession` runs `ensureAppRoot()`
    // via the surface installer before the process spawns.
    return getAppRoot();
  }
  const workspace = getWorkspace(session.workspaceId);
  if (!workspace) return null;
  // Git workspace with no usable worktree → refuse rather than silently
  // running the agent in the shared source checkout.
  if (workspace.isGit) return null;
  return workspace.cwd ?? null;
}
