import type { ChatEventSource } from '@/db/types';

/**
 * What counts as "this session is active" for rail ordering.
 *
 * This module owns the POLICY. `bumpSessionActivity` in `queries.ts` owns the
 * write. Call sites only report what happened and stay dumb about whether it
 * matters, so changing your mind about (say) whether opening a chat should
 * float it is a one-line edit here rather than an audit of the executor, the
 * terminal manager, and six queries.
 *
 * Why this is separate from `last_outcome_event_at`: that column drives the
 * *unread* derivation, so it can only ever move on agent output — your own
 * typing must not mark a chat unread. Ordering wants the opposite, the widest
 * honest definition of "something happened." One column served both, the
 * narrow definition won, and the rail ranked sessions on roughly 6% of their
 * traffic. See `src/lib/utils/session-sort.ts` for the read side.
 */

export type ActivityReason =
  // ─── Agent-side ───
  /** Assistant text landed. */
  | 'agent_output'
  /** A turn finished (`result`). */
  | 'turn_complete'
  /** A background task reported in. */
  | 'background_task'
  /** The agent invoked a tool. */
  | 'tool_call'
  /** A tool returned. */
  | 'tool_result'
  /** Extended-thinking block. */
  | 'thinking'
  /** Session/system plumbing (init frames, metadata). */
  | 'system_event'
  /** Agent hit an error, a rate limit, or needs auth. */
  | 'agent_problem'
  /** An event whose source we do not recognize. */
  | 'unknown_event'

  // ─── Human-side ───
  /** The user sent a message. */
  | 'user_message'
  /** The agent is blocked asking the user something. */
  | 'awaiting_user'
  /** The user answered a permission or question prompt. */
  | 'user_answered'
  /** The user explicitly marked the chat unread. */
  | 'mark_unread'
  /** The user typed into this execution's terminal. */
  | 'terminal'
  /** The user ran a git operation (push, merge, commit, PR). */
  | 'git'

  // ─── Deliberately NOT activity ───
  /**
   * The user opened/viewed the chat. Excluded on purpose: the composer
   * autofocuses on open (`execution-composer.tsx`), so treating this as
   * activity would make the rail re-sort as a side effect of navigation —
   * you click row 5, it jumps to row 1, and the next row you meant to click
   * has moved. Passive attention is not work.
   */
  | 'open'
  /**
   * Read receipt. Excluded for the same reason as `open`: `markRead` fires
   * on the same autofocus, so bumping here would smuggle opens back in
   * through the side door.
   */
  | 'mark_read';

/**
 * The dial. Membership here is the entire definition of activity.
 *
 * Excluded and why:
 *   - `thinking` / `system_event` — 2,770 of a representative 4,239-event day
 *     was these two. They interleave with `tool_call` on every real working
 *     stretch, so including them changes no ordering and only adds writes.
 *   - `open` / `mark_read` — see the doc comments above. Flip either on here
 *     and passive navigation starts reordering the rail.
 */
export const ACTIVITY_REASONS: ReadonlySet<ActivityReason> = new Set([
  'agent_output',
  'turn_complete',
  'background_task',
  'tool_call',
  'tool_result',
  'agent_problem',
  'unknown_event',
  'user_message',
  'awaiting_user',
  'user_answered',
  'mark_unread',
  'terminal',
  'git',
]);

/** Whether this reason should advance the session's activity timestamp. */
export function isActivity(reason: ActivityReason): boolean {
  return ACTIVITY_REASONS.has(reason);
}

/**
 * Total map from `chat_events.source` to a reason. Total (rather than
 * partial with a fallback) so adding a source to `ChatEventSource` without
 * classifying it is a type error instead of a silently-unranked event.
 */
const SOURCE_REASONS: Record<ChatEventSource, ActivityReason> = {
  agent: 'agent_output',
  result: 'turn_complete',
  background_task: 'background_task',
  thinking: 'thinking',
  tool_call: 'tool_call',
  tool_result: 'tool_result',
  system: 'system_event',
  user: 'user_message',
  recap: 'agent_output',
  cron: 'system_event',
  error: 'agent_problem',
  rate_limit: 'agent_problem',
  auth_required: 'agent_problem',
  permission_request: 'awaiting_user',
  question_request: 'awaiting_user',
  permission_response: 'user_answered',
  question_response: 'user_answered',
  unknown: 'unknown_event',
};

/**
 * Reason for a persisted chat event. Unrecognized sources (rows written
 * before a source was added to the union, or by an older build) fall back to
 * `unknown_event`, which IS activity — an event we cannot classify still
 * happened, and ranking it too high is a much cheaper mistake than making a
 * live session invisible.
 */
export function activityReasonForEventSource(source: string): ActivityReason {
  return SOURCE_REASONS[source as ChatEventSource] ?? 'unknown_event';
}

/**
 * Minimum gap between persisted bumps for the same session from a
 * high-frequency source. Terminal input arrives one HTTP POST per keystroke,
 * and the sort key does not need per-character resolution.
 */
const THROTTLE_MS = 10_000;

/**
 * Above this many tracked sessions, drop entries that are already outside the
 * throttle window. They can only answer "yes, write" anyway, so forgetting
 * them changes no behavior — it just keeps a server that runs for months
 * from accumulating one entry per session ever typed into.
 */
const PRUNE_ABOVE = 512;

const lastThrottledBump = new Map<string, number>();

/**
 * True when a high-frequency reason should actually write. In-process and
 * best-effort: a bump lost to a server restart costs at most `THROTTLE_MS`
 * of sort-key precision, which is below the resolution anyone can perceive
 * in a rail ordering.
 */
export function shouldThrottledBump(sessionId: string, now: number): boolean {
  const prev = lastThrottledBump.get(sessionId);
  if (prev !== undefined && now - prev < THROTTLE_MS) return false;
  if (lastThrottledBump.size > PRUNE_ABOVE) {
    for (const [id, at] of lastThrottledBump) {
      if (now - at >= THROTTLE_MS) lastThrottledBump.delete(id);
    }
  }
  lastThrottledBump.set(sessionId, now);
  return true;
}

/** Test seam — drops throttle state so cases do not leak into each other. */
export function resetActivityThrottle(): void {
  lastThrottledBump.clear();
}
