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
import { getProvider, listInstalledSkills, commandInventoryFromEvent } from '@agentex/agent';
import type {
  AgentSession,
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
  updateChatSession,
} from '@/lib/db/queries';
import { getAppRoot } from '@/lib/config/paths';
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
import { publishRuntime } from '@/lib/realtime/bus';
import { handleRunStreamEvent, registerToolCallName } from '@/lib/runs/event-hooks';
import { resolveSkillDirsForSession } from './skills';
import { beginRun, endRun } from '@/lib/runs/artifact-bucket';
import {
  createRun as createRunRow,
  markRunStarted as markRunStartedRow,
  markRunCompleted as markRunCompletedRow,
  markRunFailed as markRunFailedRow,
  findActiveRunForExecution,
  bumpSessionOutcome,
} from '@/lib/db/queries';
import { budgetGate } from '@/lib/runs/budget';

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
   * Number of in-flight `dispatch()` calls per chat_session. With
   * concurrent send (Claude / Codex), multiple sends can overlap —
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
}

const { agentSessions, runningSessions, inflightCount, sessionInventories } = globalRef[STATE_KEY]!;

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
 * Snapshot of every session that's currently running. Used by the rail's
 * `Working` bucket to seed its set on first connect.
 */
export function listRunningSessions(): string[] {
  return Array.from(runningSessions);
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

// ─── Bundled skill discovery ──────────────────────────────────
//
// Resolved once per process. `<cli> skills install` symlinks the shipped
// skills into <app-root>/.claude/skills/ and <app-root>/.agents/skills/;
// here we ask agentex to enumerate those symlinks and return the source
// paths. Cached because the install state doesn't change at runtime —
// re-running the CLI install is what would invalidate it, and that
// implies a restart anyway.
let cachedSkillDirs: Promise<string[]> | null = null;

export async function _resolveBundledSkillDirs(): Promise<string[]> {
  if (!cachedSkillDirs) {
    cachedSkillDirs = (async () => {
      try {
        const channels = await listInstalledSkills({ location: 'workspace', cwd: getAppRoot() });
        const dirs = new Set<string>();
        for (const skills of Object.values(channels)) {
          for (const skill of skills) {
            if (skill.sourcePath) dirs.add(skill.sourcePath);
          }
        }
        return Array.from(dirs);
      } catch (err) {
        console.warn('[executor] failed to enumerate bundled skills:', err);
        return [];
      }
    })();
  }
  return cachedSkillDirs;
}

/** Test seam: clears the skillDirs cache so the next resolve re-fetches. */
export function _resetSkillDirsCache(): void {
  cachedSkillDirs = null;
}

/**
 * Merge two skill-dir lists, deduping while preserving order. The
 * second list (user skills) gets precedence: when the same source dir
 * appears in both, the user-skill placement wins. Doesn't dedupe by
 * skill *name* — that lives in `resolveSkillsForSession`; this is the
 * unique-paths layer.
 */
function mergeSkillDirs(bundled: string[], userSkills: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const dir of [...userSkills, ...bundled]) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    out.push(dir);
  }
  return out;
}

/** Test / dev escape hatch: drop everything. Not for production paths. */
export function _resetExecutorState(): void {
  agentSessions.clear();
  runningSessions.clear();
  inflightCount.clear();
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
}

/**
 * Reset inflight count and runtime flag for a session. Health check
 * uses this after confirming a subprocess is dead — the in-memory
 * accounting drifted past whatever `dispatch`'s finally would have
 * cleared, so we force it back to zero.
 */
export function forceClearInflight(chatSessionId: string): void {
  inflightCount.delete(chatSessionId);
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

function startInflight(chatSessionId: string): void {
  const next = (inflightCount.get(chatSessionId) ?? 0) + 1;
  inflightCount.set(chatSessionId, next);
  if (next === 1) setRunning(chatSessionId, true);
}

function endInflight(chatSessionId: string): void {
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
 * Non-concurrent providers (none ship today, but the capability flag
 * leaves room): the second overlapping dispatch throws
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

  // Execution-level run mutex (docs/executions-spec.md §5). When this
  // chat belongs to an execution and a scheduled (or peer) run is
  // already mutating the worktree, reject — V1 default per
  // async-agents-v1.md open question #7. The scheduled wrapper has
  // already claimed the active run for this execution before calling
  // us, so we skip the check on its behalf.
  if (session.executionId && !options.internalCall) {
    const blocker = findActiveRunForExecution(session.executionId);
    if (blocker) {
      throw new ExecutorError(
        'already_running',
        'A scheduled run is in flight against this execution. Try again in a few seconds.',
      );
    }
  }

  // Provider capability gate. Both currently-shipped providers
  // (claude, codex) set `concurrentSend: true`, so this branch is
  // never taken today. It's here so a future non-concurrent provider
  // can opt out of overlap without us having to thread a separate
  // flag through the route layer.
  const provider = getProvider(mapHarnessToProvider(agent.harness));
  if (
    !provider.capabilities.concurrentSend &&
    inflightCount.has(chatSessionId)
  ) {
    throw new ExecutorError(
      'already_running',
      'This provider does not support concurrent send.',
    );
  }

  // Run-row instrumentation (task #12). Every dispatch creates a run row
  // — manual, scheduled, or webhook — so cost tracking and budget
  // guards are honest. The scheduled wrapper sets `internalCall: true`
  // because it has already created the row + registered the run; we
  // only spawn a `trigger='manual'` row for top-level callers.
  let manualRun: { runId: string; ownsLifecycle: boolean } | null = null;
  if (!options.internalCall) {
    const created = createRunRow({
      scheduleId: null,
      workspaceId: session.workspaceId ?? null,
      executionId: session.executionId ?? null,
      chatSessionId,
      agentId: session.agentId,
      trigger: 'manual',
      triggerPayload: null,
      scheduledFor: null,
      status: 'queued',
    });
    markRunStartedRow(created.id);
    beginRun(created.id, chatSessionId);
    manualRun = { runId: created.id, ownsLifecycle: true };
  }

  startInflight(chatSessionId);
  try {
    const agentSession = await ensureAgentSession({
      chatSessionId,
      harness: agent.harness,
      cwd,
      existingExternalSessionId: session.externalSessionId,
      permissionMode: session.permissionMode,
      model: session.model,
      effort: session.effort,
      writer,
    });
    const { result } = await agentSession.send(userMessage);
    await result;
    if (manualRun?.ownsLifecycle) {
      markRunCompletedRow(manualRun.runId);
    }
  } catch (err) {
    if (manualRun?.ownsLifecycle) {
      markRunFailedRow(manualRun.runId, {
        errorCode: 'agent_error',
        errorMessage: err instanceof Error ? err.message : String(err),
      });
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
    endInflight(chatSessionId);
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
 * Tear down the cached AgentSession for a chat_session — used when we
 * archive the chat_session or want to force resume on next dispatch.
 */
export async function close(chatSessionId: string): Promise<void> {
  const handle = agentSessions.get(chatSessionId);
  agentSessions.delete(chatSessionId);
  sessionInventories.delete(chatSessionId);
  inflightCount.delete(chatSessionId);
  setRunning(chatSessionId, false);
  rejectAllForSession(chatSessionId, 'Session closed');
  if (handle) {
    try { await handle.close(); } catch { /* best-effort */ }
  }
}

/**
 * Drop the cached AgentSession without closing pending requests. Used
 * when the user changes `permissionMode` mid-session: the next dispatch
 * spawns a fresh CLI process with the new `--permission-mode` flag,
 * resuming the conversation via `externalSessionId`. The Claude SDK
 * only reads the flag at startup — there's no in-protocol way to swap
 * modes without restarting the process.
 *
 * Best-effort close on the existing handle; we don't await it in case
 * the user is mid-stream (the runningSessions check at the route layer
 * already rejects send-while-running).
 */
export async function recycleForModeChange(chatSessionId: string): Promise<void> {
  const handle = agentSessions.get(chatSessionId);
  if (!handle) return;
  agentSessions.delete(chatSessionId);
  // Drop the inventory too — the recycled session will emit a fresh
  // system/init with potentially different available skills (e.g. plan
  // mode restricts the toolset).
  sessionInventories.delete(chatSessionId);
  // Don't reject pending requests — a mode change shouldn't blow up
  // an in-flight permission prompt the user is about to answer.
  try { await handle.close(); } catch { /* best-effort */ }
}

// ─── Internal: agent session lifecycle ────────────────────────

interface EnsureArgs {
  chatSessionId: string;
  harness: string;
  cwd: string;
  existingExternalSessionId: string | null;
  permissionMode: PermissionMode;
  model: string | null;
  effort: EffortLevel | null;
  writer: EventWriter;
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
  const claudeMode = claudePermissionFlag(args.permissionMode);
  const config: Record<string, unknown> = {};
  if (claudeMode) config.extraArgs = ['--permission-mode', claudeMode];
  if (args.model) config.model = args.model;
  // Codex provider ignores `config.effort`; passing it is harmless.
  if (args.effort) config.effort = args.effort;

  // Bundled skills live at <app-root>/.claude/skills/ and <app-root>/.agents/skills/
  // (installed via `<cli> skills install`, which runs on `start`). The session
  // opens at the workspace cwd, which is typically *not* under app-root, so
  // Claude's ancestor walk won't see them. Pass them through skillDirs so
  // agentex symlinks them into a temp dir and adds it via --add-dir.
  //
  // On top of bundled, layer in the author-neutral user-skill paths:
  //   - Global: <brain>/skills/<name>/SKILL.md
  //   - Workspace: <workspace>/.flow/skills/<name>/SKILL.md (workspace wins
  //     on name collision). See src/lib/executor/skills.ts.
  const bundled = await _resolveBundledSkillDirs();
  const userSkills = resolveSkillDirsForSession(args.cwd);
  const skillDirs = mergeSkillDirs(bundled, userSkills);
  if (skillDirs.length > 0) config.skillDirs = skillDirs;

  const handle = await provider.createSession({
    cwd: args.cwd,
    sessionParams: args.existingExternalSessionId
      ? { sessionId: args.existingExternalSessionId }
      : undefined,
    config: Object.keys(config).length > 0 ? config : undefined,
    onUserInputRequest: (req) => handleUserInputRequest(args.chatSessionId, args.writer, req),
    onEvent: async (event) => {
      try {
        _recordSessionInventory(args.chatSessionId, event);
        await persistStreamEvent(args.chatSessionId, event, args.writer);
        capturePromotedSessionId(args.chatSessionId, event);
        // Run telemetry: cost capture (#13), artifact accumulation (#14),
        // summary extraction (#15). No-op when there's no active run
        // registered for this chat — the manual-dispatch path registers
        // one before sending, scheduled dispatches do it via the
        // dispatcher wrapper.
        await handleRunStreamEventSafe(args.chatSessionId, event);
      } catch (err) {
        // One bad event shouldn't crash the whole turn — log and keep going.
        console.error(`[executor] failed to persist event for ${args.chatSessionId}:`, err);
      }
    },
  });

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
  if (event.type !== 'system') return;
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
): Promise<void> {
  const row = parseStreamEvent(chatSessionId, event);
  if (!row) return;
  await writer.write(row);
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
  const base = {
    sessionId: chatSessionId,
    externalEventId: externalEventId,
    raw: event as unknown as Record<string, unknown>,
    createdAt,
  };

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
        content: event.text ?? null,
      };
    case 'thinking':
      return {
        ...base,
        role: 'assistant',
        source: 'thinking' satisfies ChatEventSource,
        content: event.text ?? null,
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
 * teardown, manual cleanup, dev resets, reconciler running offline).
 * Auto-resume-on-view handles the click-archived-chat case by nulling
 * `worktreePath` before re-provision, but dispatch/reconcile still see
 * stale paths in the other scenarios. `existsSync` falls through to the
 * workspace cwd so `spawn` doesn't fail with `ENOENT` on a deleted dir.
 * Mirrors the local guard in `terminals/route.ts`.
 */
export function resolveCwd(session: { worktreePath: string | null; workspaceId: string | null }): string | null {
  if (session.worktreePath && existsSync(session.worktreePath)) return session.worktreePath;
  if (!session.workspaceId) return null;
  const workspace = getWorkspace(session.workspaceId);
  return workspace?.cwd ?? null;
}

