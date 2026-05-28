/**
 * Session health check — three things, in order:
 *
 *   1. Mirror the on-disk transcript into `chat_events` (reconcile).
 *   2. Clean stale in-memory state — drop dead `agentSession` handles
 *      and clear stuck `running` flags so the next dispatch goes
 *      through a fresh subprocess via `--resume`.
 *   3. Re-fire user messages that landed in our DB but never reached
 *      Claude (because `dispatch` threw between insert and stdin).
 *      We re-send the user's actual content, not synthetic text.
 *
 * That's the whole job. The transcript is what Claude sees; if our DB
 * mirrors it AND our in-memory state isn't broken, the user can chat
 * and `ensureAgentSession` will spawn fresh on their next send. Cases
 * where the agent died mid-turn (no `result` event at the tail) need
 * no special handling — the user can read the trailing message and
 * decide what to say next; their send will spawn the subprocess and
 * Claude picks up via `--resume`.
 *
 * Single shared brain. Per-send, per-view, the background sweep, the
 * cold-start sweep, and the Resync button all call this with
 * different options:
 *   - per-send       → redispatchOrphans:false (the route is about to
 *                     dispatch the same content)
 *   - everything else → redispatchOrphans:true
 *   - Resync         → also force:true to bypass the 3-min throttle
 */

import {
  getChatSession,
  listRecentChatEvents,
} from '@/lib/db/queries';
import { expandMarkers } from '@/lib/attachments/expand-markers';
import type { ChatEventRecord, ChatEventSource, Attachment } from '@/db/types';
import {
  isAgentSessionAlive,
  invalidateAgentSession,
  forceClearInflight,
  isRunning,
  dispatch,
} from './adapter';
import { reconcileSession } from './reconcile';

/**
 * - `healthy`   — session is in a state where the user can send and
 *                 the next dispatch will work.
 * - `dead`      — subprocess is gone (or never existed). State has
 *                 been cleaned; next user send spawns fresh.
 * - `ambiguous` — subprocess looks alive but no recent activity AND
 *                 an unanswered user message is sitting at the tail.
 *                 No auto-recovery (could race a slow real turn);
 *                 caller may surface its own retry affordance.
 */
export type HealthClassification = 'healthy' | 'dead' | 'ambiguous';

export interface HealthReport {
  classification: HealthClassification;
  /** Human-readable list of what was auto-fixed during this check. */
  fixes: string[];
  /** True iff we re-fired an orphan user message. */
  redispatched: boolean;
  /** Number of transcript events replayed (forwarded from reconcile). */
  replayed: number;
}

export interface HealthCheckOptions {
  /**
   * When false, the check still classifies the session and still
   * cleans in-memory state, but it does NOT re-fire orphan user
   * messages. The per-send caller sets this because it's about to
   * dispatch the same content directly.
   */
  redispatchOrphans?: boolean;
  /**
   * Bypass the 3-minute redispatch cooldown. Set only by explicit
   * user-initiated recovery (the Resync button) — automated triggers
   * (sweeps, per-view) should respect the throttle so a hard-failing
   * dispatch doesn't loop on every check.
   */
  force?: boolean;
}

/** Window we count as "agent is doing something" for the activity probe. */
const RECENT_ACTIVITY_MS = 60_000;

/** Don't re-fire the same orphan more than once per this window. Caps
 *  retry loops when the dispatch itself fails (worktree gone, auth
 *  expired, etc.) — without it, every sweep + cold start would re-fire
 *  the same broken send. In-memory; resets on process restart. */
const REDISPATCH_COOLDOWN_MS = 180_000;

/** Events that count as "agent is doing work" for the activity probe. */
const AGENT_ACTIVITY_SOURCES: ReadonlySet<ChatEventSource> = new Set([
  'agent',
  'thinking',
  'tool_call',
  'tool_result',
  'permission_request',
]);

/** Per-session timestamp of the last redispatch attempt (success or
 *  failure). Stored on globalThis so HMR doesn't fragment the map. */
const REDISPATCH_STATE_KEY = Symbol.for('@flow/health-redispatch-throttle');
interface RedispatchThrottle { lastAttempt: Map<string, number> }
const redispatchGlobal = globalThis as unknown as { [REDISPATCH_STATE_KEY]?: RedispatchThrottle };
if (!redispatchGlobal[REDISPATCH_STATE_KEY]) {
  redispatchGlobal[REDISPATCH_STATE_KEY] = { lastAttempt: new Map() };
}
const redispatchThrottle = redispatchGlobal[REDISPATCH_STATE_KEY]!;

export async function healthCheckSession(
  sessionId: string,
  options: HealthCheckOptions = {},
): Promise<HealthReport> {
  const fixes: string[] = [];
  let redispatched = false;
  let replayed = 0;

  const session = getChatSession(sessionId);
  if (!session) {
    return { classification: 'healthy', fixes, redispatched, replayed };
  }
  if (session.status === 'archived') {
    return { classification: 'healthy', fixes, redispatched, replayed };
  }

  // 1. DB ↔ transcript. reconcileSession is itself idempotent and
  //    deduped — calling it from multiple triggers is safe.
  try {
    const recon = await reconcileSession(sessionId);
    replayed = recon.replayed;
    if (recon.drift && recon.replayed > 0) {
      fixes.push(`reconciled ${recon.replayed} transcript events`);
    }
  } catch (err) {
    console.error(`[health] reconcile failed for ${sessionId}:`, err);
  }

  // 2. In-memory ↔ reality.
  const alive = isAgentSessionAlive(sessionId);
  const wasRunning = isRunning(sessionId);

  if (!alive) {
    // invalidateAgentSession is a no-op when no cached handle exists,
    // so this covers both "handle present but dead" and "no handle but
    // still flagged running" cases.
    invalidateAgentSession(sessionId);
    if (wasRunning) {
      forceClearInflight(sessionId);
      fixes.push('cleared stale running flag');
    }
  }

  // 3. Orphan detection + re-fire.
  const recent = listRecentChatEvents(sessionId, 30);
  const activity = inspectActivity(recent);

  if (activity.hasRecentAgentEvent) {
    return { classification: 'healthy', fixes, redispatched, replayed };
  }

  if (activity.orphan && !alive) {
    // Only genuine user messages are safe to re-fire. A
    // permission_response row's content is the literal string
    // "allowed" / "denied" (see buildPendingResponseEvent), and it's
    // tied to a specific tool_use_id in the now-dead subprocess —
    // there's no way to resume that tool lifecycle in a fresh CLI.
    const isRedispatchable =
      activity.orphan.role === 'user' && activity.orphan.source === 'user';
    if (options.redispatchOrphans && isRedispatchable) {
      const now = Date.now();
      const last = redispatchThrottle.lastAttempt.get(sessionId) ?? 0;
      if (!options.force && now - last < REDISPATCH_COOLDOWN_MS) {
        // Recent attempt already fired (succeeded or failed) — don't
        // pile on. The next sweep after the cooldown will retry.
        return { classification: 'dead', fixes, redispatched, replayed };
      }
      redispatchThrottle.lastAttempt.set(sessionId, now);
      try {
        const expanded = await expandMarkers(
          activity.orphan.content ?? '',
          (activity.orphan.attachments ?? []) as Attachment[],
        );
        // Fire-and-forget: awaiting the full turn would block the
        // sweep for minutes. Errors are logged and the throttle
        // prevents thrash if dispatch keeps failing.
        void dispatch(sessionId, expanded).catch((err) => {
          console.error(`[health] orphan redispatch failed for ${sessionId}:`, err);
        });
        redispatched = true;
        fixes.push('re-fired orphan user message');
      } catch (err) {
        console.error(`[health] orphan redispatch setup failed for ${sessionId}:`, err);
      }
    }
    return { classification: 'dead', fixes, redispatched, replayed };
  }

  if (!alive && wasRunning) {
    // Subprocess gone, no orphan to re-fire — still classify as
    // dead so callers (rail) can refresh.
    return { classification: 'dead', fixes, redispatched, replayed };
  }

  if (activity.orphan && alive) {
    // Subprocess looks alive AND no recent activity AND the user is
    // waiting on a response. Could be a slow real turn or wedged —
    // we don't auto-recover because re-firing might race the live
    // turn. Caller decides whether to surface this to the user.
    return { classification: 'ambiguous', fixes, redispatched, replayed };
  }

  return { classification: 'healthy', fixes, redispatched, replayed };
}

interface ActivityProbe {
  /** True iff any agent event landed within RECENT_ACTIVITY_MS. */
  hasRecentAgentEvent: boolean;
  /**
   * Latest user-side row (user message or permission_response) with
   * no follow-up agent activity, or null. Identifies a user message
   * that never reached Claude — those are safe to re-fire because
   * the content is the user's own.
   */
  orphan: ChatEventRecord | null;
}

function inspectActivity(recentDesc: ChatEventRecord[]): ActivityProbe {
  if (recentDesc.length === 0) {
    return { hasRecentAgentEvent: false, orphan: null };
  }
  const now = Date.now();
  let hasRecentAgentEvent = false;
  for (const e of recentDesc) {
    if (!AGENT_ACTIVITY_SOURCES.has(e.source as ChatEventSource)) continue;
    const age = now - new Date(e.createdAt).getTime();
    if (age <= RECENT_ACTIVITY_MS) {
      hasRecentAgentEvent = true;
      break;
    }
  }

  // Orphan = latest interesting row is user-side with no agent event
  // afterwards. Walk newest-first; the first interesting event we
  // hit decides the outcome.
  let orphan: ChatEventRecord | null = null;
  for (const e of recentDesc) {
    if (e.role === 'user' || e.source === 'permission_response') {
      orphan = e;
      break;
    }
    if (AGENT_ACTIVITY_SOURCES.has(e.source as ChatEventSource) || e.source === 'result') {
      // Newest event is agent activity or turn end — not an orphan.
      break;
    }
  }

  return { hasRecentAgentEvent, orphan };
}

// Exported only for tests.
export const _internals = {
  inspectActivity,
  RECENT_ACTIVITY_MS,
  AGENT_ACTIVITY_SOURCES,
};
