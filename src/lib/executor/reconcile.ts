/**
 * Transcript reconciliation: keep `chat_events` in sync with the
 * provider's durable on-disk JSONL after server crashes, missed live
 * events, or sleep/disconnect gaps.
 *
 * The shape is the same for both providers — drift check via
 * `peek(size)`, replay via `read(fromOffset)`, checkpoint the offset
 * back onto the chat_session row — but the data types diverge:
 *
 *   - Claude yields `StreamEvent`s. Wire-level uuids land in
 *     `externalEventId` (see `parseStreamEvent`), so the partial
 *     unique index makes replay-vs-live collisions a no-op. Reconcile
 *     is safe to run even while a turn is mid-flight.
 *
 *   - Codex yields `CodexTranscriptLine`s. No stable wire id ships
 *     with each line, so the live and replay paths produce distinct
 *     `externalEventId`s for the same logical event. To avoid
 *     duplicates we only reconcile when the executor's `isRunning`
 *     flag is false for that session — the live stream is the source
 *     of truth during active turns; reconcile only catches up
 *     afterwards (or after a crash).
 *
 * Drift detection is a single `fs.stat`. First-ever reconcile per
 * session initializes the cursor at the current head without
 * replaying, so pre-reconcile-era rows aren't duplicated.
 */

import {
  // Claude
  getClaudeTranscriptPath,
  peekClaudeTranscript,
  readClaudeTranscript,
  type ClaudeTranscriptLocation,
  // Codex
  getCodexTranscriptPath,
  peekCodexTranscript,
  readCodexTranscript,
  type CodexTranscriptLocation,
} from '@agentex/agent';
import {
  getChatSessionWithExecution,
  updateChatSession,
  listReconcilableSessions,
  listStuckBootstrapExecutions,
  recordExecutionSetupError,
  getAgent,
  insertChatEvent,
} from '@/lib/db/queries';
import {
  publishReconcileStarted,
  publishReconcileDone,
} from '@/lib/realtime/bus';
import type { ChatSessionRecord, ChatSessionWithExecution } from '@/db/types';
import { mapHarnessToProvider } from './harness';
import { persistStreamEvent, resolveCwd, isRunning } from './adapter';
import { mapCodexLineToInput } from './codex-on-disk';

export interface ReconcileResult {
  /** Whether the on-disk transcript was ahead of our chat_events. */
  drift: boolean;
  /** Number of new events appended to chat_events during this call. */
  replayed: number;
  /**
   * Why we no-op'd, if applicable. `'no_transcript'` is a normal state
   * (the provider hasn't written a file yet); `'unsupported_provider'`
   * applies to harnesses without an agentex transcript reader;
   * `'no_cwd'` means the chat_session row doesn't have enough info to
   * locate the transcript; `'running'` means we deferred to the live
   * stream for a Codex session that's currently mid-turn;
   * `'in_flight'` means another reconcile for this session was already
   * running and we returned without starting a second one.
   */
  skipped?:
    | 'no_transcript'
    | 'unsupported_provider'
    | 'no_cwd'
    | 'no_external_session'
    | 'running'
    | 'in_flight';
}

/**
 * Per-session in-flight guard. Two callers race in practice:
 *   - React StrictMode double-mounts the on-visit reconcile effect,
 *     firing the POST twice.
 *   - The cold-start sweep can overlap with an on-visit reconcile if
 *     the user opens a session within the sweep's window.
 *
 * Both would read the same `externalSyncOffset`, replay the same
 * delta, and race on the cursor update. For Claude the wire-uuid dedup
 * makes the replays idempotent at the DB level, but for Codex (no wire
 * id) the second replay would produce duplicate rows. Skipping the
 * second call entirely is simplest and correct for both providers.
 *
 * Stashed on `globalThis` under a Symbol so Next.js HMR doesn't
 * fragment the set across module reloads — same pattern as the
 * executor and bus state.
 */
interface ReconcileState {
  inFlight: Set<string>;
}
const STATE_KEY = Symbol.for('@flow/reconcile-state');
const globalRef = globalThis as unknown as { [STATE_KEY]?: ReconcileState };
if (!globalRef[STATE_KEY]) globalRef[STATE_KEY] = { inFlight: new Set() };
const state = globalRef[STATE_KEY]!;

/**
 * Reconcile one session against its on-disk transcript. Safe to call
 * concurrently for any number of sessions; concurrent calls for the
 * same session id are deduped by the in-flight guard above — the
 * second caller returns immediately with `skipped: 'in_flight'`.
 */
export async function reconcileSession(sessionId: string): Promise<ReconcileResult> {
  if (state.inFlight.has(sessionId)) {
    return { drift: false, replayed: 0, skipped: 'in_flight' };
  }
  state.inFlight.add(sessionId);
  try {
    const session = getChatSessionWithExecution(sessionId);
    if (!session) return { drift: false, replayed: 0, skipped: 'no_cwd' };
    if (!session.externalSessionId) {
      return { drift: false, replayed: 0, skipped: 'no_external_session' };
    }

    const agent = getAgent(session.agentId);
    const provider = agent ? mapHarnessToProvider(agent.harness) : null;
    if (provider === 'claude') return await reconcileClaudeSession(session);
    if (provider === 'codex') return await reconcileCodexSession(session);
    return { drift: false, replayed: 0, skipped: 'unsupported_provider' };
  } finally {
    state.inFlight.delete(sessionId);
  }
}

// ─── Shared helpers ───────────────────────────────────────────

/**
 * No-replay outcome with an optional path-cache side effect. Used in
 * the "no transcript on disk" and "no drift" paths for both providers.
 * `freshlyResolved` is true only when this call computed the path for
 * the first time — repeat calls already have it cached on the session
 * row, so the update is a no-op we elide.
 */
function noReplayResult(
  sessionId: string,
  filePath: string,
  freshlyResolved: boolean,
  skipped?: ReconcileResult['skipped'],
): ReconcileResult {
  if (freshlyResolved) {
    updateChatSession(sessionId, { externalTranscriptPath: filePath });
  }
  return { drift: false, replayed: 0, skipped };
}

/**
 * First-time-init outcome — write the cursor at current head without
 * replaying. Existing `chat_events` rows from before reconcile landed
 * used minted uuid7s as `externalEventId`; replaying their JSONL
 * counterparts would produce duplicates because the wire uuid now
 * lands in that column for new writes. Anchoring without replay
 * accepts losing pre-existing drift on the first call and dedups
 * cleanly forever after.
 */
function anchorCursor(
  sessionId: string,
  filePath: string,
  size: number,
  lastEventId: string | null,
): ReconcileResult {
  updateChatSession(sessionId, {
    externalTranscriptPath: filePath,
    externalSyncOffset: size,
    externalSyncLastEventId: lastEventId,
  });
  return { drift: false, replayed: 0 };
}

function hasOffsetCursor(session: ChatSessionRecord): boolean {
  return session.externalSyncOffset !== null && session.externalSyncOffset !== undefined;
}

// ─── Claude ───────────────────────────────────────────────────

async function reconcileClaudeSession(session: ChatSessionWithExecution): Promise<ReconcileResult> {
  if (!session.externalSessionId) {
    return { drift: false, replayed: 0, skipped: 'no_external_session' };
  }
  const cwd = resolveCwd(session);
  if (!cwd) return { drift: false, replayed: 0, skipped: 'no_cwd' };

  // Resolve or recover the transcript path. After the first successful
  // resolve we cache it on the chat_session row — saves an O(1) compute
  // (and a `realpath` syscall) on subsequent reconciles.
  let filePath = session.externalTranscriptPath ?? null;
  const freshlyResolved = !filePath;
  if (!filePath) {
    const location: ClaudeTranscriptLocation = await getClaudeTranscriptPath({
      sessionId: session.externalSessionId,
      cwd,
    });
    filePath = location.filePath;
  }

  const peek = await peekClaudeTranscript(filePath);
  if (peek.size === null) {
    return noReplayResult(session.id, filePath, freshlyResolved, 'no_transcript');
  }

  if (!hasOffsetCursor(session)) {
    return anchorCursor(session.id, filePath, peek.size, peek.lastEvent?.eventId ?? null);
  }

  if (peek.size === session.externalSyncOffset) {
    return noReplayResult(session.id, filePath, freshlyResolved);
  }

  publishReconcileStarted(session.id);
  let replayed = 0;
  let lastOffset = session.externalSyncOffset!;
  let lastEventId: string | null = session.externalSyncLastEventId ?? null;

  try {
    for await (const yielded of readClaudeTranscript({
      filePath,
      fromOffset: lastOffset,
    })) {
      await persistStreamEvent(session.id, yielded.event);
      replayed++;
      lastOffset = yielded.offset;
      if (yielded.event.eventId) lastEventId = yielded.event.eventId;
    }
  } catch (err) {
    console.error(`[reconcile] claude replay failed for ${session.id}:`, err);
  }

  updateChatSession(session.id, {
    externalTranscriptPath: filePath,
    externalSyncOffset: lastOffset,
    externalSyncLastEventId: lastEventId,
  });
  publishReconcileDone(session.id, replayed);

  return { drift: true, replayed };
}

// ─── Codex ────────────────────────────────────────────────────

async function reconcileCodexSession(session: ChatSessionWithExecution): Promise<ReconcileResult> {
  if (!session.externalSessionId) {
    return { drift: false, replayed: 0, skipped: 'no_external_session' };
  }

  // Codex events carry no stable wire id, so replay can't dedup
  // against a concurrent live stream at the DB level. Defer to the
  // live path while a turn is in flight; the reconcile sweep on the
  // next cold start (or on the next session-open after the turn
  // ends) will catch up any drift that's accumulated.
  if (isRunning(session.id)) {
    return { drift: false, replayed: 0, skipped: 'running' };
  }

  // Codex rollouts are organized by date, not cwd; find() scans the
  // date tree by session id. Caching the resolved path on the chat
  // session row avoids that scan on every subsequent call.
  let filePath = session.externalTranscriptPath ?? null;
  const freshlyResolved = !filePath;
  if (!filePath) {
    const location: CodexTranscriptLocation | null = await getCodexTranscriptPath({
      sessionId: session.externalSessionId,
    });
    if (!location) {
      return { drift: false, replayed: 0, skipped: 'no_transcript' };
    }
    filePath = location.filePath;
  }

  const peek = await peekCodexTranscript(filePath);
  if (peek.size === null) {
    return noReplayResult(session.id, filePath, freshlyResolved, 'no_transcript');
  }

  if (!hasOffsetCursor(session)) {
    // Codex lines have no eventId field — track only the offset.
    return anchorCursor(session.id, filePath, peek.size, null);
  }

  if (peek.size === session.externalSyncOffset) {
    return noReplayResult(session.id, filePath, freshlyResolved);
  }

  publishReconcileStarted(session.id);
  let replayed = 0;
  let lastOffset = session.externalSyncOffset!;

  try {
    for await (const yielded of readCodexTranscript({
      filePath,
      fromOffset: lastOffset,
    })) {
      const input = mapCodexLineToInput(session.id, yielded.event);
      // Advance the byte cursor regardless — lines we drop (telemetry,
      // metadata, dupes) are still consumed and shouldn't be re-read
      // on the next reconcile.
      lastOffset = yielded.offset;
      if (input) {
        insertChatEvent(input);
        replayed++;
      }
    }
  } catch (err) {
    console.error(`[reconcile] codex replay failed for ${session.id}:`, err);
  }

  updateChatSession(session.id, {
    externalTranscriptPath: filePath,
    externalSyncOffset: lastOffset,
  });
  publishReconcileDone(session.id, replayed);

  return { drift: true, replayed };
}

// ─── Cold-start sweep ─────────────────────────────────────────

/**
 * Reconcile every active session with an `externalSessionId` AND
 * heal in-memory state. Used at server cold start. Runs sequentially —
 * each call is cheap when there's no drift, and the sequential pattern
 * keeps SQLite-write contention trivially zero and the log output
 * ordered.
 *
 * Note: sequential here only rate-limits the *kickoff* of orphan
 * redispatches, not their subprocess spawns. health.ts fires `dispatch`
 * as fire-and-forget so the sweep can finish quickly; the actual CLI
 * spawns happen in parallel. For realistic loads (single-user, small
 * number of mid-turn sessions when the server died) this is fine. If
 * we ever observe a wide stampede on cold start — say 20+ sessions
 * with unanswered messages — add a small spawn-rate semaphore around
 * the `void dispatch(...)` call in health.ts. The 3-minute redispatch
 * throttle prevents thrash on repeated cold starts but doesn't bound
 * the initial wave.
 *
 * The cold-start health check redispatches confirmed orphans so the
 * user comes back to completed responses without having to open each
 * stuck session manually.
 */
export async function reconcileAllSessions(): Promise<{
  checked: number;
  drifted: number;
  replayed: number;
  redispatched: number;
  reapedStuckBootstraps: number;
  errors: number;
}> {
  // Local import — health.ts imports reconcileSession from this file,
  // so the top-of-file import would loop.
  const { healthCheckSession } = await import('./health');

  // Reap stuck bootstraps before the main sweep so they get a
  // setupError visible in the rail by the time the UI loads. The
  // provisionWorktreeForSession promise is gone (it died with the
  // previous process if the server restarted mid-provision; otherwise
  // it's hanging on a syscall that never returns). Either way, the
  // row is wedged with no recovery — marking it lets the UI surface
  // a retry affordance.
  //
  // SAFETY: this reaper is ONLY safe from cold start. The 5-minute
  // age check is a wall-clock heuristic, not a process-liveness one.
  // A provision in a sibling worker (or a future scheduled-task
  // process) could still legitimately be running at the 5-minute
  // mark. Don't call this from a hot-path background sweep without
  // also gating on a process-scoped "this provision is mine"
  // marker.
  let reapedStuckBootstraps = 0;
  try {
    const stuck = listStuckBootstrapExecutions();
    for (const e of stuck) {
      recordExecutionSetupError(e.id, 'Setup did not complete in time. Retry to start over.');
      reapedStuckBootstraps++;
    }
  } catch (err) {
    console.error('[reconcile] bootstrap reap failed:', err);
  }

  const sessions: ChatSessionRecord[] = listReconcilableSessions();
  let checked = 0;
  let drifted = 0;
  let replayed = 0;
  let redispatched = 0;
  let errors = 0;

  for (const session of sessions) {
    checked++;
    try {
      const report = await healthCheckSession(session.id, { redispatchOrphans: true });
      if (report.replayed > 0) drifted++;
      replayed += report.replayed;
      if (report.redispatched) redispatched++;
    } catch (err) {
      errors++;
      console.error(`[reconcile] session ${session.id} threw:`, err);
    }
  }

  return { checked, drifted, replayed, redispatched, reapedStuckBootstraps, errors };
}
