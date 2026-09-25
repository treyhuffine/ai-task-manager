/**
 * The local runner: harness sessions on this computer (docs/homes-build.md,
 * "P2.1 The runner split").
 *
 * Owns every live `AgentSession` handle and the live state around it
 * (`live-state.ts`), keyed by our `chat_sessions.id`. It starts a session
 * from a `SessionSpec`, sends, interrupts, stops tasks, closes and recycles,
 * and answers pending prompts. Everything it learns goes to the runner sink:
 * chat events through the sink's writer, and running flags, background
 * tasks, prompts, native session ids and turn results as signals.
 *
 * It never reads the database. The home decides what a session needs and
 * sends it as the spec, and a mode the agent changes itself (leaving plan
 * mode) is tracked here from the spec's pre-plan mode. The same code serves
 * the home's own computer in its server process and a connected computer's
 * worker.
 *
 * Process restart empties the state. The next send passes the chat's native
 * session id in its spec, so the harness resumes its own on-disk session.
 *
 * Lifecycle assumptions:
 *   - `provider.createSession({ cwd, onEvent, sessionParams })` returns a
 *     handle whose `send(message)` resolves when the message is accepted,
 *     with a `result` promise that settles when the turn ends.
 *   - `onEvent` fires for every `StreamEvent` across all turns; we parse
 *     and report each.
 *   - `onUserInputRequest` routes through `pending.ts`. In `auto_all` mode
 *     (the default for new sessions) tool permissions are auto-allowed
 *     without surfacing. `ask | auto_edits | plan` are translated per-harness
 *     in `permission-map.ts` and every prompt that comes back surfaces.
 *     AskUserQuestion always surfaces.
 */

import { getProvider, commandInventoryFromEvent } from '@agentex/agent';
import type { AgentSession, ProviderConfig, StreamEvent, UserInputRequest, UserInputResponse } from '@agentex/agent';
import type { CreateChatEventInput } from '@/db/types';
import { harnessPermissionConfig } from '@/lib/executor/permission-map';
import { DEFAULT_PERMISSION_MODE } from '@/lib/permissions/modes';
import { clearSessionInstructions, writeSessionInstructions } from '@/lib/executor/session-instructions';
import { resolveSkillDirsForSession } from '@/lib/executor/skills';
import { decodeBackgroundTaskEvent, isActiveBackgroundTaskEvent } from '@/lib/executor/background-task-event';
import { removeOwnedProjectSkillLinks } from '@/lib/agent-skills/shipped';
import { getHarnessRuntime, runtimeContextForHarness } from '@/lib/harness/runtime';
import { redactHarnessRuntimeValue } from '@/lib/harness/redaction';
import { harnessDefinition, type HarnessId } from '@/lib/harness/registry';
import { ExecutorError } from './errors';
import { withFirstTurnPreamble } from './first-turn';
import { runnerState, isRunning } from './live-state';
import { parseStreamEvent } from './parse';
import { getPending, listForSession, register as registerPending, rejectAllForSession, resolveRequest } from './pending';
import { classifyRequest } from './pending-classify';
import { runnerSink } from './sink';
import type {
  AnswerResult,
  EventWriter,
  ExecutionRunner,
  RunnerSignal,
  SendRequest,
  SendResult,
  SessionSpec,
  StopReport,
} from './types';

const state = runnerState;

// ─── Running flag ─────────────────────────────────────────────

function report(chatSessionId: string, signal: RunnerSignal): void {
  try {
    runnerSink().signal(chatSessionId, signal);
  } catch (err) {
    console.error(`[runner] failed to report ${signal.type} for ${chatSessionId}:`, err);
  }
}

/**
 * Mutate the running flag and report it. Only reports when the value
 * actually changes, so a same-state update doesn't burn cycles downstream.
 */
function setRunning(chatSessionId: string, running: boolean): void {
  const wasRunning = state.runningSessions.has(chatSessionId);
  if (running) state.runningSessions.add(chatSessionId);
  else state.runningSessions.delete(chatSessionId);
  if (state.harnessSessions.has(chatSessionId)) state.lastActivityAt.set(chatSessionId, Date.now());
  if (wasRunning !== running) report(chatSessionId, { type: 'running', running });
  // The turn a deferred recycle was waiting on just ended.
  if (!running && state.pendingRecycles.delete(chatSessionId)) {
    void recycleForModeChange(chatSessionId).catch((err) => {
      console.error(`[runner] deferred recycle failed for ${chatSessionId}:`, err);
    });
  }
}

/**
 * Recompute "is this session working" from both signals and report the union.
 *
 * Our own dispatch count cannot see the whole picture: Claude Code ends the
 * root turn when it launches a background task, then opens a *new* turn by
 * itself once that task finishes. `send()` has long since resolved, so a
 * dispatch-counted session reads finished while the agent is visibly editing
 * files — measured at eleven minutes on a real session.
 *
 * agentex 0.0.37 reports those turns as `turn_start`/`turn_end`. Taking the
 * union rather than replacing the counter keeps providers that emit no turn
 * events (Codex, OpenCode) working exactly as before: they only ever
 * contribute the dispatch side.
 */
function refreshRunning(chatSessionId: string): void {
  const dispatching = (state.inflightCount.get(chatSessionId) ?? 0) > 0;
  setRunning(chatSessionId, dispatching || state.openStreamTurns.has(chatSessionId));
}

/**
 * Sessions the provider says have a turn open right now.
 *
 * Every `turn_start` is closed by exactly one `turn_end` — including the
 * paths that produce no `result` (a message the CLI cancels, discards, or
 * refuses) and session teardown — so this cannot leak a permanently-working
 * session the way a `result`-only close would.
 */
function trackTurnBoundary(chatSessionId: string, event: StreamEvent): void {
  const type = (event as { type?: string }).type;
  if (type === 'turn_start') state.openStreamTurns.add(chatSessionId);
  else if (type === 'turn_end') state.openStreamTurns.delete(chatSessionId);
  else return;
  refreshRunning(chatSessionId);
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

  let ids = state.backgroundTasks.get(chatSessionId);
  let membershipChanged = false;
  if (isActiveBackgroundTaskEvent(task)) {
    if (!ids) {
      ids = new Set();
      state.backgroundTasks.set(chatSessionId, ids);
    }
    if (!ids.has(task.taskId)) {
      ids.add(task.taskId);
      membershipChanged = true;
    }
  } else if (ids) {
    membershipChanged = ids.delete(task.taskId);
    if (ids.size === 0) state.backgroundTasks.delete(chatSessionId);
  }

  if (!membershipChanged) return false;
  report(chatSessionId, {
    type: 'background_tasks',
    active: state.backgroundTasks.has(chatSessionId),
    taskIds: Array.from(state.backgroundTasks.get(chatSessionId) ?? []),
  });
  return true;
}

function clearBackgroundTasks(chatSessionId: string): void {
  if (!state.backgroundTasks.delete(chatSessionId)) return;
  report(chatSessionId, { type: 'background_tasks', active: false, taskIds: [] });
}

/** Forget a torn-down session's turn state so it cannot read working forever. */
function clearStreamTurn(chatSessionId: string): void {
  if (!state.openStreamTurns.delete(chatSessionId)) return;
  refreshRunning(chatSessionId);
}

/**
 * Record the runtime command inventory from a provider `system/init`
 * event. First non-null wins — subsequent init events for the same
 * session don't overwrite, so a re-handshake mid-session doesn't
 * clobber the original inventory the UI is reconciling against.
 *
 * Exported with the underscore prefix as a test seam — production
 * code reaches this through the session's `onEvent` callback.
 */
export function _recordSessionInventory(chatSessionId: string, event: StreamEvent): void {
  const inventory = commandInventoryFromEvent(event);
  if (inventory && !state.sessionInventories.has(chatSessionId)) {
    state.sessionInventories.set(chatSessionId, inventory);
    if (state.harnessSessions.has(chatSessionId)) report(chatSessionId, { type: 'inventory', inventory });
  }
}

/** Test seam: put a handle in the session cache as if it had spawned. */
export function _cacheHarnessSession(chatSessionId: string, handle: AgentSession): void {
  state.harnessSessions.set(chatSessionId, handle);
}

/** Test / dev escape hatch: drop everything. Not for production paths. */
export function _resetExecutorState(): void {
  // Retire every token handed out before the reset. The monotonic allocator is
  // deliberately not reset, so a late finalizer can never match new work.
  state.nextDispatchGeneration++;
  state.harnessSessions.clear();
  state.sessionInfo.clear();
  state.runningSessions.clear();
  state.inflightCount.clear();
  state.activeDispatchCount.clear();
  state.dispatchGenerations.clear();
  state.backgroundTasks.clear();
  state.openStreamTurns.clear();
  state.sessionInventories.clear();
  state.pendingRecycles.clear();
  state.lastActivityAt.clear();
}

// ─── Liveness ─────────────────────────────────────────────────

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
export function isHarnessSessionAlive(chatSessionId: string): boolean {
  const handle = state.harnessSessions.get(chatSessionId);
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
export function invalidateHarnessSession(chatSessionId: string): void {
  state.harnessSessions.delete(chatSessionId);
  state.sessionInfo.delete(chatSessionId);
  state.lastActivityAt.delete(chatSessionId);
  state.sessionInventories.delete(chatSessionId);
  clearBackgroundTasks(chatSessionId);
  clearStreamTurn(chatSessionId);
}

/**
 * Reset inflight count and runtime flag for a session. Health check
 * uses this after confirming a subprocess is dead — the in-memory
 * accounting drifted past whatever a send's finally would have
 * cleared, so we force it back to zero.
 */
export function forceClearInflight(chatSessionId: string): void {
  advanceDispatchGeneration(chatSessionId);
  state.inflightCount.delete(chatSessionId);
  state.activeDispatchCount.delete(chatSessionId);
  setRunning(chatSessionId, false);
}

// ─── Inflight reference counting ──────────────────────────────
//
// Concurrent send lets multiple sends overlap: the user types a follow-up
// while the previous turn is still in flight, the second send enters while
// the first is awaiting `result`. A plain `runningSessions.add/.delete` Set
// flips off the moment any one send finishes — even while peers are
// outstanding — causing the runtime-status SSE to flicker false and the UI's
// Stop button to revert to Send mid-turn. Counting solves it: the public
// `runningSessions` Set only transitions on 0→1 (start) and N→0 (everyone's
// done), so SSE subscribers see clean edges.

export type DispatchLifecycleRefKind = 'preparation' | 'active';

export interface DispatchLifecycleRef {
  readonly generation: number;
  readonly kind: DispatchLifecycleRefKind;
}

function currentDispatchGeneration(chatSessionId: string): number {
  const existing = state.dispatchGenerations.get(chatSessionId);
  if (existing !== undefined) return existing;
  const next = ++state.nextDispatchGeneration;
  state.dispatchGenerations.set(chatSessionId, next);
  return next;
}

function advanceDispatchGeneration(chatSessionId: string): number {
  const next = ++state.nextDispatchGeneration;
  state.dispatchGenerations.set(chatSessionId, next);
  return next;
}

function startInflight(chatSessionId: string, kind: DispatchLifecycleRefKind): DispatchLifecycleRef {
  const next = (state.inflightCount.get(chatSessionId) ?? 0) + 1;
  state.inflightCount.set(chatSessionId, next);
  if (next === 1) refreshRunning(chatSessionId);
  return { generation: currentDispatchGeneration(chatSessionId), kind };
}

function endInflight(chatSessionId: string, ref: DispatchLifecycleRef): void {
  if (state.dispatchGenerations.get(chatSessionId) !== ref.generation) return;
  const cur = state.inflightCount.get(chatSessionId) ?? 0;
  const next = cur - 1;
  if (next <= 0) {
    state.inflightCount.delete(chatSessionId);
    // Not necessarily idle: a provider-initiated turn may still be open.
    refreshRunning(chatSessionId);
  } else {
    state.inflightCount.set(chatSessionId, next);
  }
}

/**
 * Hold the public runtime flag across asynchronous preparation that happens
 * before a send enters its own lifecycle. The messages route persists and
 * acknowledges a user event before worktree repair and provider checks finish.
 * Counting this preparation prevents a false idle gap and balances safely with
 * the nested send count, including concurrent sends.
 */
export function beginDispatchPreparation(chatSessionId: string): DispatchLifecycleRef {
  return startInflight(chatSessionId, 'preparation');
}

export function endDispatchPreparation(chatSessionId: string, ref: DispatchLifecycleRef): void {
  if (ref.kind !== 'preparation') return;
  endInflight(chatSessionId, ref);
}

/**
 * Enter the provider-send portion of a dispatch. Preparation references are
 * intentionally excluded from the concurrency check. The messages route owns
 * one before it sends, so treating preparation as an active send would reject
 * every first request for providers without concurrent send.
 *
 * Exported as a narrow test seam for the accounting invariant.
 */
export function _beginActiveDispatch(chatSessionId: string, concurrentSendSupported: boolean): DispatchLifecycleRef {
  if (!concurrentSendSupported && state.activeDispatchCount.has(chatSessionId)) {
    throw new ExecutorError('already_running', 'This provider does not support concurrent send.');
  }
  state.activeDispatchCount.set(chatSessionId, (state.activeDispatchCount.get(chatSessionId) ?? 0) + 1);
  return startInflight(chatSessionId, 'active');
}

/** Complete one provider send while preserving any preparation references. */
export function _endActiveDispatch(chatSessionId: string, ref: DispatchLifecycleRef): void {
  if (ref.kind !== 'active' || state.dispatchGenerations.get(chatSessionId) !== ref.generation) return;
  const current = state.activeDispatchCount.get(chatSessionId) ?? 0;
  if (current <= 0) return;
  if (current === 1) state.activeDispatchCount.delete(chatSessionId);
  else state.activeDispatchCount.set(chatSessionId, current - 1);
  endInflight(chatSessionId, ref);
}

// ─── Sending ──────────────────────────────────────────────────

/** A live handle for the chat, dropping a dead one on the way. */
function liveHandle(chatSessionId: string): AgentSession | null {
  const cached = state.harnessSessions.get(chatSessionId);
  if (!cached) return null;
  if (isHarnessSessionAlive(chatSessionId)) return cached;
  // Stale corpse: the SDK or our liveness probe knows the subprocess is
  // gone. Drop it so the send starts a fresh one. Returning dead handles
  // produced silent "Session is closed" throws on the very next send.
  invalidateHarnessSession(chatSessionId);
  return null;
}

/**
 * Send a message into the chat's harness, starting it from the spec when
 * there's no live session. Resolves once the harness accepted the message.
 * The turn's end is reported as `turn_result`, after the running flag for
 * this send has been released.
 *
 * Concurrent send (Claude + Codex): callable mid-turn. The CLI's own queue
 * handles ordering — Claude drains queued messages into the active turn as
 * `<system-reminder>` attachments on the next tool result; Codex merges
 * them as additional userMessage items in the same turn. Providers without
 * concurrent send (Cursor, OpenCode) reject an overlapping send with
 * `already_running`.
 */
export async function send(req: SendRequest): Promise<SendResult> {
  const { chatSessionId } = req;
  const live = liveHandle(chatSessionId);
  const info = live ? state.sessionInfo.get(chatSessionId) : undefined;
  const harness = info?.harness ?? req.spec?.harness;
  const cwd = info?.cwd ?? req.spec?.cwd;
  if (!harness || (!live && !req.spec)) return { status: 'needs_spec' };

  const runtime = await getHarnessRuntime(harness, { cwd });
  if (!runtime.capabilities.sessions.supported) {
    throw new ExecutorError('unsupported', runtime.capabilities.sessions.reason ?? `${harness} sessions are unavailable`);
  }
  const ref = _beginActiveDispatch(chatSessionId, runtime.capabilities.concurrentSend.supported);
  let result: Promise<unknown>;
  try {
    const handle = live ?? (await startSession(req.spec!));
    const sent = await handle.send(withFirstTurnPreamble(req.message, takeFirstTurnPreamble(handle)));
    result = sent.result;
  } catch (err) {
    _endActiveDispatch(chatSessionId, ref);
    throw err;
  }
  void result.then(
    () => finishTurn(req, ref, null),
    (err: unknown) => finishTurn(req, ref, err instanceof Error ? err.message : String(err)),
  );
  return { status: 'delivered' };
}

function finishTurn(req: SendRequest, ref: DispatchLifecycleRef, error: string | null): void {
  _endActiveDispatch(req.chatSessionId, ref);
  report(req.chatSessionId, { type: 'turn_result', turnId: req.turnId, runId: req.runId, ok: error === null, error });
}

/**
 * Briefs waiting to ride the first message of a freshly spawned session,
 * for harnesses that drop session instructions (agent-main-chat.ts). Keyed
 * by the handle, so a recycled session never inherits a stale one.
 */
const firstTurnPreambles = new WeakMap<AgentSession, string>();

function takeFirstTurnPreamble(handle: AgentSession): string | null {
  const preamble = firstTurnPreambles.get(handle) ?? null;
  if (preamble) firstTurnPreambles.delete(handle);
  return preamble;
}

/** Spawn the harness for a spec. The home decided what it needs; this adds what only this computer knows. */
async function startSession(spec: SessionSpec): Promise<AgentSession> {
  const providerType = harnessDefinition(spec.harness).agentexProviderId;
  const provider = getProvider(providerType);
  if (!provider.createSession) {
    throw new ExecutorError('unsupported', `Provider "${providerType}" does not implement multi-turn createSession`);
  }

  const [runtimeContext, runtime] = await Promise.all([
    runtimeContextForHarness(spec.harness, { cwd: spec.cwd }),
    getHarnessRuntime(spec.harness, { cwd: spec.cwd }),
  ]);
  if (!runtime.capabilities.sessions.supported) {
    throw new ExecutorError('unsupported', runtime.capabilities.sessions.reason ?? `${providerType} sessions are unavailable`);
  }
  // Translate the app-native permission mode into harness config at the one
  // boundary that owns it (see permission-map.ts). auto_all/plan ride agentex's
  // generic skipPermissions/planMode; ask/auto_edits become Claude flags.
  const perm = harnessPermissionConfig(spec.permissionMode, providerType, {
    planMode: runtime.capabilities.planMode.supported,
  });
  const config: ProviderConfig = {
    ...runtimeContext.config,
    unattendedPermissionPolicy: 'deny',
    ...(perm.skipPermissions ? { skipPermissions: true } : {}),
    ...(perm.planMode ? { planMode: true } : {}),
  };
  if (spec.model) config.model = spec.model;
  if (spec.modelVariant && runtime.capabilities.modelVariants.supported) config.modelVariant = spec.modelVariant;
  // Canonical id straight through. agentex owns the per-provider vocabulary
  // and translates at the flag boundary.
  if (spec.effort && runtime.capabilities.reasoningEffort.supported) config.effort = spec.effort;
  if (spec.strictMcpConfig) config.strictMcpConfig = true;
  if (spec.mcpServers.length > 0) config.mcpServers = spec.mcpServers;
  if (spec.disallowedTools.length > 0) config.disallowedTools = [...spec.disallowedTools];
  if (spec.instructions) config.instructionsFile = writeSessionInstructions(spec.chatSessionId, spec.instructions);
  const extraArgs = [...perm.extraArgs, ...spec.extraArgs];
  if (extraArgs.length > 0) config.extraArgs = extraArgs;

  // Shipped skills are discovered from the app root or the user's explicit
  // global install. Never pass them through skillDirs here. The Codex provider
  // materializes configured skillDirs inside the project, which previously
  // left an app-owned .agents/skills/orchestrator symlink in every workspace.
  // Clean that legacy link only when it points to our shipped skill.
  if (spec.cleanLegacySkillLinks) {
    try {
      const cleanup = await removeOwnedProjectSkillLinks(spec.cwd);
      if (cleanup.entries.some((entry) => entry.status === 'error')) {
        console.warn('[runner] failed to clean one or more legacy project skill links');
      }
    } catch (err) {
      console.warn('[runner] failed to clean legacy project skill links:', err);
    }
  }

  // Author-neutral user-skill paths:
  //   - Global: <brain>/skills/<name>/SKILL.md
  //   - Workspace: <workspace>/.ri/skills/<name>/SKILL.md (workspace wins
  //     on name collision). See src/lib/executor/skills.ts.
  const skillDirs = resolveSkillDirsForSession(spec.cwd);
  if (skillDirs.length > 0) {
    if (spec.attachUserSkills) config.skillDirs = skillDirs;
    else {
      console.warn(
        `[runner] agent main chat on provider "${providerType}": user skills are not attached, ` +
          "because this harness would write them into the agent's folder.",
      );
    }
  }

  const chatSessionId = spec.chatSessionId;
  const handle = await provider.createSession({
    cwd: spec.cwd,
    env: { ...runtimeContext.env, ...spec.env },
    sessionParams: spec.nativeSessionId ? { sessionId: spec.nativeSessionId } : undefined,
    config: Object.keys(config).length > 0 ? config : undefined,
    onUserInputRequest: (req) => handleUserInputRequest(chatSessionId, req),
    onEvent: async (event) => {
      try {
        const safeEvent = redactHarnessRuntimeValue(event);
        _recordSessionInventory(chatSessionId, safeEvent);
        state.lastActivityAt.set(chatSessionId, Date.now());
        await persistStreamEvent(chatSessionId, safeEvent, runnerSink().writer, { trackBackgroundTaskRuntime: true });
        reportNativeSession(chatSessionId, safeEvent.sessionId);
      } catch (err) {
        // One bad event shouldn't crash the whole turn — log and keep going.
        console.error(`[runner] failed to report event for ${chatSessionId}:`, err);
      }
    },
  });

  state.harnessSessions.set(chatSessionId, handle);
  state.sessionInfo.set(chatSessionId, {
    harness: spec.harness,
    cwd: spec.cwd,
    permissionMode: spec.permissionMode,
    prePlanMode: spec.prePlanMode,
    nativeSessionId: spec.nativeSessionId,
  });
  state.lastActivityAt.set(chatSessionId, Date.now());
  if (spec.firstTurnPreamble) firstTurnPreambles.set(handle, spec.firstTurnPreamble);

  // Service-backed providers can assign their session id before emitting any
  // stream event. Report it immediately so a host crash during the first turn
  // still leaves enough identity for durable history recovery.
  const record = handle.describeHistory?.() ?? handle.describe?.();
  const promotedId = typeof record?.params.sessionId === 'string' ? record.params.sessionId : handle.sessionId;
  reportNativeSession(chatSessionId, promotedId);
  return handle;
}

/**
 * Claude Code (and most providers) emit a `system` event near the start of a
 * session whose `sessionId` is the CLI's own session id. Report it when it
 * differs from what the chat already has, so future resumes work.
 */
function reportNativeSession(chatSessionId: string, nativeSessionId: string | null | undefined): void {
  if (!nativeSessionId) return;
  const info = state.sessionInfo.get(chatSessionId);
  if (info) {
    if (info.nativeSessionId === nativeSessionId) return;
    info.nativeSessionId = nativeSessionId;
  }
  report(chatSessionId, { type: 'native_session', nativeSessionId });
}

/**
 * Translate an agentex tool-permission request into a pending prompt, report
 * it, then await the answer. Called once per tool call that needs approval
 * (every mutating tool in `ask` mode, Bash in `auto_edits` mode, etc.) and
 * once per AskUserQuestion.
 *
 * In `auto_all` mode tool permissions short-circuit. The mode is the one the
 * session started with, or the mode it returned to on leaving plan mode.
 */
async function handleUserInputRequest(chatSessionId: string, req: UserInputRequest): Promise<UserInputResponse> {
  const info = state.sessionInfo.get(chatSessionId);
  const mode = info?.permissionMode ?? DEFAULT_PERMISSION_MODE;
  const pending = classifyRequest(chatSessionId, req);

  // auto_all: only AskUserQuestion still needs UI. Auto-allowing a question
  // returns empty answers to Claude and the agent stalls — surface it.
  //
  // updatedInput must be present on every allow response. Claude's
  // PermissionAllowResultSchema requires it as a record; an empty object
  // is treated as "use original input" but the field still has to exist.
  // Without it Claude raises a Zod error and the tool call fails as if
  // we'd denied — except the agent reads it as a tool failure and retries.
  if (mode === 'auto_all' && pending.kind === 'permission') {
    return { allow: true, updatedInput: req.input };
  }

  report(chatSessionId, { type: 'pending_input', pending });
  const response = await registerPending(pending);
  report(chatSessionId, { type: 'pending_resolved', pending, response });

  // Claude leaves plan mode itself when ExitPlanMode is allowed. Mirror it,
  // so later prompts in this session follow the mode it returned to.
  if (pending.kind === 'permission' && pending.toolName === 'ExitPlanMode' && response.allow && info?.permissionMode === 'plan') {
    info.permissionMode = info.prePlanMode ?? DEFAULT_PERMISSION_MODE;
    info.prePlanMode = null;
  }
  return response;
}

/**
 * Answer a pending prompt. Only a prompt this chat raised can be answered
 * through it, so an answer can't reach another chat's harness.
 */
export function answerPendingInput(chatSessionId: string, requestId: string, response: UserInputResponse): AnswerResult {
  const pending = getPending(requestId);
  if (!pending || pending.sessionId !== chatSessionId) return { ok: false };
  return resolveRequest(requestId, response);
}

// ─── Stream events ────────────────────────────────────────────

export async function persistStreamEvent(
  chatSessionId: string,
  event: StreamEvent,
  writer: EventWriter,
  options: { trackBackgroundTaskRuntime?: boolean } = {},
): Promise<void> {
  const safeEvent = redactHarnessRuntimeValue(event);
  // Runtime signal, not transcript content — and it has to be applied even
  // though the event persists nothing, which is why it runs before the
  // early return below.
  trackTurnBoundary(chatSessionId, safeEvent);
  const row: CreateChatEventInput | null = parseStreamEvent(chatSessionId, safeEvent);
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

// ─── Control ──────────────────────────────────────────────────

/**
 * Interrupt the current turn for a chat_session, if any. The agent
 * receives SIGTERM / equivalent and the in-flight turn ends (typically
 * with a `result` event flagged as aborted).
 */
export async function abort(chatSessionId: string): Promise<void> {
  const handle = state.harnessSessions.get(chatSessionId);
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
export async function stopTask(chatSessionId: string, taskId: string): Promise<{ stopped: boolean }> {
  const handle = state.harnessSessions.get(chatSessionId);
  if (!handle) return { stopped: false };
  return handle.stopTask(taskId);
}

/**
 * Tear down the cached AgentSession for a chat_session — used when we
 * archive the chat_session or want to force resume on next send.
 *
 * Returns whether the underlying handle closed cleanly. Most callers ignore the
 * result (best-effort recycling), but a coordinated "stop the running agent"
 * needs to know honestly whether the process was actually torn down, so it can
 * refuse to claim the agent stopped when the close failed.
 */
export async function close(chatSessionId: string): Promise<StopReport> {
  const handle = state.harnessSessions.get(chatSessionId);
  // Close the process FIRST, while the handle is still tracked. If close fails
  // the process may still be alive, so we keep the handle cached (still
  // trackable / retryable) and DO NOT clear running state or the caches — losing
  // the handle here would leave an untrackable live process. Only after a clean
  // close (or no handle at all) do we drop the cached state.
  if (handle) {
    try {
      await handle.close();
    } catch (err) {
      return { closed: false, error: err instanceof Error ? err.message : String(err) };
    }
  }
  state.harnessSessions.delete(chatSessionId);
  state.sessionInfo.delete(chatSessionId);
  state.lastActivityAt.delete(chatSessionId);
  state.sessionInventories.delete(chatSessionId);
  advanceDispatchGeneration(chatSessionId);
  state.inflightCount.delete(chatSessionId);
  state.activeDispatchCount.delete(chatSessionId);
  setRunning(chatSessionId, false);
  clearBackgroundTasks(chatSessionId);
  clearStreamTurn(chatSessionId);
  clearSessionInstructions(chatSessionId);
  rejectAllForSession(chatSessionId, 'Session closed');
  return { closed: true };
}

/**
 * Recycle a session now if it is idle, or as soon as its current turn ends.
 * Settings changes use this rather than `recycleForModeChange`, because
 * closing a handle mid-turn cuts the turn off.
 */
export async function recycleWhenIdle(chatSessionId: string): Promise<void> {
  if (isRunning(chatSessionId)) {
    state.pendingRecycles.add(chatSessionId);
    return;
  }
  await recycleForModeChange(chatSessionId);
}

/**
 * Close every cached session for one harness after its credential store
 * changes. Agentex retires its runtime generation, while this clears handles
 * that captured the old environment or retired OpenCode server.
 */
export async function recycleHarnessSessions(harness: HarnessId): Promise<void> {
  const affected: string[] = [];
  for (const [sessionId, info] of state.sessionInfo) {
    if (info.harness === harness) affected.push(sessionId);
  }
  await Promise.all(affected.map((sessionId) => close(sessionId)));
}

/**
 * Drop the cached AgentSession without closing pending requests. Used when
 * selection changes require the next send to spawn a fresh CLI process and
 * resume the conversation through its native session id.
 *
 * Best-effort close on the existing handle. Selection-changing routes reject
 * changes during an active turn before reaching this function. Other callers
 * use it for lifecycle invalidation where closing the old handle is expected.
 */
export async function recycleForModeChange(chatSessionId: string): Promise<void> {
  const handle = state.harnessSessions.get(chatSessionId);
  if (!handle) return;
  state.harnessSessions.delete(chatSessionId);
  state.sessionInfo.delete(chatSessionId);
  state.lastActivityAt.delete(chatSessionId);
  // Drop the inventory too — the recycled session will emit a fresh
  // system/init with potentially different available skills (e.g. plan
  // mode restricts the toolset).
  state.sessionInventories.delete(chatSessionId);
  clearBackgroundTasks(chatSessionId);
  clearStreamTurn(chatSessionId);
  // Don't reject pending requests — a mode change shouldn't blow up
  // an in-flight permission prompt the user is about to answer.
  try { await handle.close(); } catch { /* best-effort */ }
}

// ─── Idle close ───────────────────────────────────────────────

/** How long a session may sit with nothing happening before its process is closed. */
export const IDLE_CLOSE_MS = 30 * 60 * 1000;

/**
 * Close sessions idle for `idleMs`: nothing running, no pending prompt, no
 * background task, no recycle owed. The next message resumes the harness
 * from its native session id, so closing only frees the process. Returns
 * the chats it closed.
 */
export async function closeIdleSessions(now = Date.now(), idleMs = IDLE_CLOSE_MS): Promise<string[]> {
  const idle: string[] = [];
  for (const chatSessionId of state.harnessSessions.keys()) {
    const last = state.lastActivityAt.get(chatSessionId);
    if (last === undefined || now - last < idleMs) continue;
    if (state.runningSessions.has(chatSessionId)) continue;
    if ((state.inflightCount.get(chatSessionId) ?? 0) > 0) continue;
    if (state.backgroundTasks.has(chatSessionId)) continue;
    if (state.pendingRecycles.has(chatSessionId)) continue;
    if (listForSession(chatSessionId).length > 0) continue;
    idle.push(chatSessionId);
  }
  const closed: string[] = [];
  for (const chatSessionId of idle) {
    const result = await close(chatSessionId);
    if (result.closed) closed.push(chatSessionId);
  }
  return closed;
}

// ─── The runner interface ─────────────────────────────────────

export const localRunner: ExecutionRunner = {
  send,
  interrupt: abort,
  stopTask,
  stop: close,
  answerPendingInput,
};
