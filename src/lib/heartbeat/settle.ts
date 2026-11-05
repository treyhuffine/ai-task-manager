/**
 * What a finished check-in leaves behind. It's background work, so its chat is
 * archived and never reaches Unread, whatever it found. Its run says what
 * happened, History lists it, and its Now section goes to their main agent. Did
 * and Later wait in its reply for later check-ins to read (notes.ts). See
 * docs/heartbeat-spec.md §5.4 and §15.
 */

import { archiveChatSession, getChatSession, getRun, getUserState, listRuns, updateRun } from '@/lib/db/queries';
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
import { isQuietReply, parseCheckInNote } from './prompt';

/** A note's first item as one short line, for run lists. A line ending in a colon only introduces the items. */
function firstItem(note: string): string {
  const lines = note
    .split('\n')
    .map((text) => text.replace(/\[\[[^\]]*\]\]/g, '').replace(/[*_`]/g, '').replace(/^\s*[-•]\s*/, '').trim())
    .filter(Boolean);
  const line = lines.find((text) => !text.endsWith(':')) ?? lines[0] ?? '';
  return line.length > 160 ? `${line.slice(0, 159)}…` : line;
}

/**
 * Settle a completed heartbeat run. Returns null when this isn't one, and
 * whether a note went to the main agent otherwise.
 */
export function settleHeartbeatRun(runId: string, chatSessionId: string): { handedOff: boolean } | null {
  const run = getRun(runId);
  if (!run || run.triggerId !== RESERVED_TRIGGER_IDS.heartbeat) return null;
  if (run.status !== 'completed') return null;
  const source = getChatSession(chatSessionId);
  if (!source) return null;

  const reply = turnReply(chatSessionId);
  const note = reply && !isQuietReply(reply) ? parseCheckInNote(reply) : null;
  if (note?.now) {
    const name = resolveOrchestratorName(getUserState()?.orchestratorName);
    updateRun(runId, { statusReason: HEARTBEAT_TOLD_REASON, summary: `Told ${name}: ${firstItem(note.now)}` });
  } else if (note?.later) {
    updateRun(runId, { statusReason: HEARTBEAT_HELD_REASON, summary: `Saved for later: ${firstItem(note.later)}` });
  } else {
    updateRun(runId, { statusReason: HEARTBEAT_QUIET_REASON, summary: note?.did ? `Did: ${firstItem(note.did)}` : HEARTBEAT_QUIET_SUMMARY });
  }

  if (note?.now) {
    const told = listRuns({ triggerId: RESERVED_TRIGGER_IDS.heartbeat, status: 'completed', limit: 500 }).some((other) => other.id !== runId && other.statusReason === HEARTBEAT_TOLD_REASON);
    handOffToMainAgent(getRun(runId)!, source, note.now, { first: !told, did: note.did });
  }
  archiveChatSession(chatSessionId);
  return { handedOff: !!note?.now };
}
