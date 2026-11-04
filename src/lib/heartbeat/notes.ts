/**
 * What a check-in wakes up knowing. Each one is a fresh chat with no memory, so
 * the app hands it the time, what earlier check-ins did, and what happened to
 * chats since the last one. That's what lets instructions say "once each
 * morning", keeps it from raising the same thing again, and spares it crawling
 * every chat to find out what changed.
 *
 * Earlier check-ins' notes are read back from their final replies, so nothing
 * is stored twice. Reads are by `session_id`, one chat at a time, and bounded.
 */

import { isManagerChat } from '@/lib/coordination/address';
import { getChatSession, listNeedsReviewSessionCandidates, listRuns } from '@/lib/db/queries';
import { turnReply } from '@/lib/notifications/turn-reply';
import { dateTimeInTimezone } from '@/lib/scheduler/frequency';
import { RESERVED_TRIGGER_IDS, TRIGGERS_WITH_OWN_REVIEW_SURFACE } from '@/lib/triggers/reserved';
import type { RunRecord, TriggerRecord } from '@/db/types';
import {
  DEFAULT_HEARTBEAT_INTERVAL_SECONDS,
  HEARTBEAT_HELD_REASON,
  HEARTBEAT_MEMORY_DAYS,
  HEARTBEAT_TOLD_REASON,
} from './constants';
import { checkInNoteFailed } from './handoff';
import { parseCheckInNote, type CheckInNote } from './prompt';

const DAY_MS = 24 * 60 * 60 * 1000;

/** Enough to carry the point without crowding out the user's instructions. */
const MAX_NOTES_CHARS = 6000;

/** Every check-in in the memory window at the shortest interval. */
const MAX_CHECK_INS = 900;

/** How far back to look for chats that finished. A day of a busy home, and only the newest are kept. */
const RECENT_RUNS = 100;
const MAX_CHATS = 25;

function finishedAt(run: RunRecord): string {
  return run.completedAt ?? run.startedAt ?? run.queuedAt;
}

function formatTime(iso: string, timezone: string): string {
  return new Date(iso).toLocaleTimeString('en-US', { timeZone: timezone, hour: 'numeric', minute: '2-digit' });
}

function formatWhen(iso: string, timezone: string): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** Only these replies can hold anything: the rest said HEARTBEAT_OK and changed nothing. */
function noteOf(run: RunRecord): CheckInNote | null {
  const hasNote = run.statusReason === HEARTBEAT_TOLD_REASON || run.statusReason === HEARTBEAT_HELD_REASON || (run.artifactRefs ?? []).length > 0;
  const reply = hasNote && run.chatSessionId ? turnReply(run.chatSessionId) : null;
  return reply ? parseCheckInNote(reply) : null;
}

function rightNow(checkIns: RunRecord[], timezone: string, now: Date): string {
  const when = now.toLocaleString('en-US', { timeZone: timezone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  const today = dateTimeInTimezone(now, timezone).date;
  const earlier = checkIns
    .filter((run) => dateTimeInTimezone(new Date(finishedAt(run)), timezone).date === today)
    .map((run) => formatTime(finishedAt(run), timezone))
    .reverse();
  const running = listRuns({ status: 'running', limit: 50 }).filter((run) => run.triggerId !== RESERVED_TRIGGER_IDS.heartbeat).length;
  const waiting = listNeedsReviewSessionCandidates().length;
  return [
    '## Right now',
    '',
    `It's ${when} in ${timezone}.`,
    earlier.length > 0 ? `Check-ins so far today: ${earlier.join(', ')}.` : 'This is the first check-in today.',
    `Chats running: ${running}. Chats waiting for the user to read: ${waiting}.`,
  ].join('\n');
}

/**
 * What the last few days of check-ins passed along, newest first. A note that
 * never reached the main agent doesn't count, so this one tries again. After
 * `HEARTBEAT_MEMORY_DAYS` something still unresolved can come up again.
 */
function earlierNotes(checkIns: RunRecord[], timezone: string): string | null {
  const entries: string[] = [];
  let length = 0;
  for (const run of checkIns) {
    const note = noteOf(run);
    if (!note) continue;
    const told = note.now && !checkInNoteFailed(run);
    const parts = [note.did && `**Did**\n${note.did}`, told && `**Told them**\n${note.now}`, note.later && `**Later**\n${note.later}`].filter(Boolean);
    if (parts.length === 0) continue;
    const entry = `${formatWhen(finishedAt(run), timezone)}\n${parts.join('\n')}`;
    if (length + entry.length > MAX_NOTES_CHARS) break;
    entries.push(entry);
    length += entry.length;
  }
  if (entries.length === 0) return null;
  return `## Earlier check-ins\n\nFrom the last ${HEARTBEAT_MEMORY_DAYS} days, newest first. Don't raise these again unless something changed or the instructions say to tell them now.\n\n${entries.join('\n\n')}`;
}

/** What happened to chats since the last check-in, so it reads only the ones that need it. */
function chatsSince(since: string, timezone: string): string | null {
  const skip = new Set<string>([RESERVED_TRIGGER_IDS.heartbeat, ...TRIGGERS_WITH_OWN_REVIEW_SURFACE]);
  const newest = new Map<string, RunRecord>();
  for (const run of listRuns({ status: ['completed', 'failed', 'cancelled'], limit: RECENT_RUNS })) {
    if (!run.chatSessionId || !run.completedAt || run.completedAt < since) continue;
    if (run.triggerId && skip.has(run.triggerId)) continue;
    if (!newest.has(run.chatSessionId)) newest.set(run.chatSessionId, run);
  }
  const lines: string[] = [];
  for (const [chatId, run] of newest) {
    const chat = getChatSession(chatId);
    if (!chat || isManagerChat(chat)) continue;
    if (lines.length === MAX_CHATS) break;
    const failure = run.status === 'failed' && run.errorMessage ? `: ${run.errorMessage.slice(0, 160)}` : '';
    const status = chat.turnStatus ? ` Its status: "${chat.turnStatus.line}"${chat.turnStatus.needsYou ? ' (waiting on the user)' : ''}` : '';
    lines.push(`- ${chat.label ?? 'Untitled chat'} (sessionId ${chatId}): ${run.status} at ${formatTime(run.completedAt!, timezone)}${failure}.${status}`);
  }
  if (lines.length === 0) return null;
  return `## Chats since the last check-in\n\n${lines.join('\n')}`;
}

export function checkInContext(trigger: Pick<TriggerRecord, 'id' | 'timezone' | 'intervalSeconds'>, now: Date = new Date()): string {
  const timezone = trigger.timezone ?? 'UTC';
  const window = new Date(now.getTime() - HEARTBEAT_MEMORY_DAYS * DAY_MS).toISOString();
  const checkIns = listRuns({ triggerId: trigger.id, status: 'completed', since: window, limit: MAX_CHECK_INS });
  const since = checkIns[0]
    ? finishedAt(checkIns[0])
    : new Date(now.getTime() - (trigger.intervalSeconds ?? DEFAULT_HEARTBEAT_INTERVAL_SECONDS) * 1000).toISOString();
  return [rightNow(checkIns, timezone, now), earlierNotes(checkIns, timezone), chatsSince(since, timezone)].filter(Boolean).join('\n\n');
}
