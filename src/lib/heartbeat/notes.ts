/**
 * What earlier check-ins passed along, read back from their final replies. A
 * check-in's chat is the record, so nothing is stored twice: a run's
 * `statusReason` says whether it has a note, and the note is its reply.
 *
 * Reads are by `session_id`, one chat at a time, and bounded.
 */

import { getTrigger, listRuns } from '@/lib/db/queries';
import { turnReply } from '@/lib/notifications/turn-reply';
import { dateTimeInTimezone } from '@/lib/scheduler/frequency';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import type { RunArtifactRef, RunRecord, TriggerRecord } from '@/db/types';
import {
  HEARTBEAT_DAILY_HOUR,
  HEARTBEAT_HELD_REASON,
  HEARTBEAT_MEMORY_DAYS,
  HEARTBEAT_QUIET_REASON,
  HEARTBEAT_TOLD_REASON,
} from './constants';
import { checkInNoteFailed } from './handoff';
import { parseCheckInNote, type CheckInNote } from './prompt';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Enough to carry the point without crowding out the user's instructions. */
const MAX_RAISED_CHARS = 6000;

/** Every completed check-in in two days at the shortest interval. */
const MAX_RUNS = 600;

function isSettled(run: RunRecord): boolean {
  return run.statusReason === HEARTBEAT_QUIET_REASON || run.statusReason === HEARTBEAT_TOLD_REASON || run.statusReason === HEARTBEAT_HELD_REASON;
}

function noteOf(run: RunRecord): CheckInNote | null {
  if (run.statusReason !== HEARTBEAT_TOLD_REASON && run.statusReason !== HEARTBEAT_HELD_REASON) return null;
  const reply = run.chatSessionId ? turnReply(run.chatSessionId) : null;
  return reply ? parseCheckInNote(reply) : null;
}

function finishedAt(run: RunRecord): string {
  return run.completedAt ?? run.startedAt ?? run.queuedAt;
}

function formatWhen(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/**
 * What the last few days of check-ins already raised, newest first, for the
 * next check-in's prompt. Without it, a fresh chat with no history would raise
 * the same thing every interval. After `HEARTBEAT_MEMORY_DAYS` something still
 * unresolved can come up again. A note that never reached the main agent
 * doesn't count, so the next check-in tries again.
 */
export function alreadyRaised(trigger: Pick<TriggerRecord, 'id' | 'timezone'>, now: Date = new Date()): string | null {
  const timezone = trigger.timezone ?? 'UTC';
  const since = new Date(now.getTime() - HEARTBEAT_MEMORY_DAYS * DAY_MS).toISOString();
  const entries: string[] = [];
  let length = 0;
  for (const run of listRuns({ triggerId: trigger.id, status: 'completed', since, limit: MAX_RUNS })) {
    const note = noteOf(run);
    if (!note) continue;
    const when = formatWhen(finishedAt(run), timezone);
    const told = note.now && !checkInNoteFailed(run, 'now');
    const parts = [told && `${when}, told right away:\n${note.now}`, note.later && `${when}, saved for the daily message:\n${note.later}`];
    const entry = parts.filter(Boolean).join('\n\n');
    if (!entry) continue;
    if (length + entry.length > MAX_RAISED_CHARS) break;
    entries.push(entry);
    length += entry.length;
  }
  return entries.join('\n\n') || null;
}

/**
 * The day a check-in belongs to for the daily message. It turns over at
 * `HEARTBEAT_DAILY_HOUR` in the heartbeat's timezone, so a check-in at 8am is
 * still part of yesterday. A daylight saving change moves the turnover by an
 * hour for one day, which doesn't matter here.
 */
function checkInDay(iso: string, timezone: string): string {
  return dateTimeInTimezone(new Date(Date.parse(iso) - HEARTBEAT_DAILY_HOUR * HOUR_MS), timezone).date;
}

function changeMarker(ref: RunArtifactRef): string | null {
  if (ref.kind === 'task' || ref.kind === 'note') return `[[${ref.kind}:${ref.id}]]`;
  // The UI calls a workspace an agent. Memory has no chip.
  return ref.kind === 'workspace' ? `[[agent:${ref.id}]]` : null;
}

function changeMarkers(runs: RunRecord[]): string[] {
  const seen = new Set<string>();
  for (const run of runs) {
    for (const ref of run.artifactRefs ?? []) {
      const marker = changeMarker(ref);
      if (marker) seen.add(marker);
    }
  }
  return [...seen];
}

/**
 * The daily message's note, or null when this isn't the check-in that carries
 * it or there's nothing to say. The first settled check-in of each day carries
 * it, so no state records that it was sent. It covers that check-in's own Later
 * items and changes, and the most recent earlier day's, apart from the check-in
 * that carried that day's message, which already sent its own.
 */
export function dailyNote(run: RunRecord, now: Date = new Date()): string | null {
  const trigger = getTrigger(RESERVED_TRIGGER_IDS.heartbeat);
  const timezone = trigger?.timezone ?? 'UTC';
  const today = checkInDay(finishedAt(run), timezone);
  // Newest first. A check-in someone stopped never settled, so it sent nothing.
  const others = listRuns({ triggerId: RESERVED_TRIGGER_IDS.heartbeat, status: 'completed', limit: MAX_RUNS })
    .filter((other) => other.id !== run.id && isSettled(other));
  if (others.some((other) => checkInDay(finishedAt(other), timezone) === today)) return null;

  const cutoff = now.getTime() - HEARTBEAT_MEMORY_DAYS * DAY_MS;
  const recent = others.filter((other) => Date.parse(finishedAt(other)) >= cutoff);
  const previousDay = recent[0] ? checkInDay(finishedAt(recent[0]), timezone) : null;
  const covered = [run, ...recent.filter((other) => checkInDay(finishedAt(other), timezone) === previousDay).slice(0, -1)];

  const waiting = covered.map((other) => noteOf(other)?.later).filter((later): later is string => !!later);
  const changed = changeMarkers(covered);
  if (waiting.length === 0 && changed.length === 0) return null;
  const sections = [
    waiting.length > 0 && `Waiting on them:\n\n${waiting.join('\n\n')}`,
    changed.length > 0 && `Changed for them:\n\n${changed.join('\n')}`,
  ];
  return sections.filter(Boolean).join('\n\n');
}
