/**
 * What a finished check-in leaves behind. It's background work, so its chat is
 * archived and never reaches Unread, whatever it found. Its run says what
 * happened, History lists it, and what's worth telling the user goes to their
 * main agent: right away for what can't wait, in the day's first check-in for
 * the rest. See docs/heartbeat-spec.md §5.4 and §15.
 */

import { archiveChatSession, getChatSession, getRun, getUserState, updateRun } from '@/lib/db/queries';
import { turnReply } from '@/lib/notifications/turn-reply';
import { resolveOrchestratorName } from '@/lib/orchestrator/name';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import {
  HEARTBEAT_HELD_REASON,
  HEARTBEAT_QUIET_REASON,
  HEARTBEAT_QUIET_SUMMARY,
  HEARTBEAT_TOLD_REASON,
} from './constants';
import { handOffToMainAgent } from './handoff';
import { dailyNote } from './notes';
import { isQuietReply, parseCheckInNote } from './prompt';

/** A note's first item as one short line, for run lists. */
function firstItem(note: string): string {
  const line = note
    .split('\n')
    .map((text) => text.replace(/\[\[[^\]]*\]\]/g, '').replace(/[*_`]/g, '').replace(/^\s*[-•]\s*/, '').trim())
    .find(Boolean) ?? '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/**
 * Settle a completed heartbeat run. Returns null when this isn't one, and
 * whether a note went to the main agent otherwise. A reply that isn't the quiet
 * token is a note. Changes alone need no reply: the app recorded them on the
 * run, and the daily message covers them.
 */
export function settleHeartbeatRun(runId: string, chatSessionId: string): { handedOff: boolean } | null {
  const run = getRun(runId);
  if (!run || run.triggerId !== RESERVED_TRIGGER_IDS.heartbeat) return null;
  if (run.status !== 'completed') return null;
  const source = getChatSession(chatSessionId);
  if (!source) return null;

  const reply = turnReply(chatSessionId);
  const note = reply && !isQuietReply(reply) ? parseCheckInNote(reply) : null;
  const name = resolveOrchestratorName(getUserState()?.orchestratorName);
  if (note?.now) updateRun(runId, { statusReason: HEARTBEAT_TOLD_REASON, summary: `Told ${name}: ${firstItem(note.now)}` });
  else if (note?.later) updateRun(runId, { statusReason: HEARTBEAT_HELD_REASON, summary: `Saved for the daily message: ${firstItem(note.later)}` });
  else updateRun(runId, { statusReason: HEARTBEAT_QUIET_REASON, summary: HEARTBEAT_QUIET_SUMMARY });

  const settled = getRun(runId)!;
  let handedOff = false;
  if (note?.now) {
    handOffToMainAgent(settled, source, 'now', note.now);
    handedOff = true;
  }
  const daily = dailyNote(settled);
  if (daily) {
    handOffToMainAgent(settled, source, 'daily', daily);
    handedOff = true;
  }
  archiveChatSession(chatSessionId);
  return { handedOff };
}
