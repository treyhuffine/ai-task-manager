/**
 * The local runner's live state, and the read side of it.
 *
 * The local runner (`local-runner.ts`) changes this state; everything here
 * only reads it. It imports nothing heavy, so the rail and other status
 * readers can use it without compiling the agent engine.
 *
 * Stashed on globalThis (with a Symbol key) so the maps survive Next.js
 * module re-evaluation across route handlers. Each App Router route is
 * bundled independently and may re-import this file with a fresh module
 * scope. Without globalThis the messages route's `runningSessions` would be
 * a different Set than the runtime-status route's, and the UI would never
 * see the running flag flip.
 */

import type { AgentSession, RuntimeCommandInventory } from '@agentex/agent';
import type { PermissionMode } from '@/db/types';
import type { HarnessId } from '@/lib/harness/registry';

/** What the runner remembers about a live session from the spec that started it. */
export interface LiveSessionInfo {
  harness: HarnessId;
  cwd: string;
  permissionMode: PermissionMode;
  prePlanMode: PermissionMode | null;
  /** The native session id last reported to the sink. */
  nativeSessionId: string | null;
}

export interface RunnerState {
  harnessSessions: Map<string, AgentSession>;
  sessionInfo: Map<string, LiveSessionInfo>;
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
   * Chat sessions whose provider reports a turn currently open.
   *
   * Distinct from `inflightCount`, which only counts turns *we* dispatched.
   * Claude Code starts turns on its own after a background task finishes, and
   * those are invisible to the counter — the session read finished while the
   * agent was still working. Fed by `turn_start`/`turn_end` (agentex 0.0.37+);
   * providers that emit neither never appear here and are unaffected.
   */
  openStreamTurns: Set<string>;
  /**
   * Skill command inventory reported by the provider's session at boot
   * (via `system/init` for Claude — see `commandInventoryFromEvent`).
   * Keyed by our chat session id. Populated once per session lifetime,
   * cleared when the session is dropped. The slash-commands API route
   * reads this to mark `available` on discovered descriptors.
   */
  sessionInventories: Map<string, RuntimeCommandInventory>;
  /**
   * Chat sessions owed a recycle once their current turn ends
   * (`recycleWhenIdle`). Recycling closes the live handle, which would cut
   * off a turn mid-flight, including the very turn that changed the setting
   * (a main chat editing its own agent's instructions).
   */
  pendingRecycles: Set<string>;
  /** When each live session last started or finished work, for the idle close. */
  lastActivityAt: Map<string, number>;
  /**
   * Per chat, the messages out in its harness, oldest first: the harness's id
   * for each (agentex's command uuid) and the run it belongs to. What a turn
   * produces is charged to the run of the message that opened it.
   */
  sendRuns: Map<string, Map<string, string | null>>;
  /**
   * Per chat, the harness turn open now: the message that opened it, when the
   * harness names it, or that the harness started it on its own (`resume`),
   * and its run once known. The run is fixed for the turn, so a message
   * whose result settles before the turn's last events are handled doesn't
   * change it.
   */
  openTurnOpeners: Map<string, { commandUuid: string | null; resume: boolean; runId?: string | null }>;
}

const STATE_KEY = Symbol.for('@ri/executor-state');
const globalRef = globalThis as unknown as { [STATE_KEY]?: Partial<RunnerState> };

function initState(): RunnerState {
  const existing = globalRef[STATE_KEY] ?? {};
  // HMR migration: state survives from a build that predates some fields.
  const state: RunnerState = {
    harnessSessions: existing.harnessSessions ?? new Map(),
    sessionInfo: existing.sessionInfo ?? new Map(),
    runningSessions: existing.runningSessions ?? new Set(),
    inflightCount: existing.inflightCount ?? new Map(),
    activeDispatchCount: existing.activeDispatchCount ?? new Map(),
    dispatchGenerations: existing.dispatchGenerations ?? new Map(),
    nextDispatchGeneration: typeof existing.nextDispatchGeneration === 'number' ? existing.nextDispatchGeneration : 0,
    backgroundTasks: existing.backgroundTasks ?? new Map(),
    openStreamTurns: existing.openStreamTurns ?? new Set(),
    sessionInventories: existing.sessionInventories ?? new Map(),
    pendingRecycles: existing.pendingRecycles ?? new Set(),
    lastActivityAt: existing.lastActivityAt ?? new Map(),
    sendRuns: existing.sendRuns ?? new Map(),
    openTurnOpeners: existing.openTurnOpeners ?? new Map(),
  };
  globalRef[STATE_KEY] = state;
  return state;
}

/** The one state object. Shared, never replaced, so every reader sees the same maps. */
export const runnerState: RunnerState = initState();

export function isRunning(chatSessionId: string): boolean {
  return runnerState.runningSessions.has(chatSessionId);
}

/** Every session with a turn in flight. Seeds the rail's Working bucket. */
export function listRunningSessions(): string[] {
  return Array.from(runnerState.runningSessions);
}

/** Sessions that still have one or more active background tasks. */
export function listBackgroundTaskSessions(): string[] {
  return Array.from(runnerState.backgroundTasks.keys());
}

export function hasBackgroundTasks(chatSessionId: string): boolean {
  return runnerState.backgroundTasks.has(chatSessionId);
}

export function listBackgroundTaskIds(chatSessionId: string): string[] {
  return Array.from(runnerState.backgroundTasks.get(chatSessionId) ?? []);
}

/**
 * The skill/slash command inventory the provider session reported at boot.
 * Null if the session hasn't booted yet or the provider emitted none.
 */
export function getSessionInventory(chatSessionId: string): RuntimeCommandInventory | null {
  return runnerState.sessionInventories.get(chatSessionId) ?? null;
}

/** Whether a session has a cached handle (a live harness process). */
export function hasHarnessSession(chatSessionId: string): boolean {
  return runnerState.harnessSessions.has(chatSessionId);
}

/** Provider sends currently active for a session, excluding preparation. */
export function activeSendCount(chatSessionId: string): number {
  return runnerState.activeDispatchCount.get(chatSessionId) ?? 0;
}
