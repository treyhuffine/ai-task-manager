/**
 * Quiet check-ins: a heartbeat run that found nothing and changed nothing
 * leaves no trace in Unread. Its chat is archived and the run is labeled, so
 * the heartbeat's status can say "nothing needed" without a chat to dismiss.
 * See docs/heartbeat-spec.md §5.4.
 */

import {
  archiveChatSession,
  getRun,
  listRecentChatEvents,
  updateRun,
} from '@/lib/db/queries';
import { RESERVED_TRIGGER_IDS } from '@/lib/triggers/reserved';
import { HEARTBEAT_QUIET_REASON, HEARTBEAT_QUIET_SUMMARY } from './constants';
import { isQuietReply } from './prompt';

/** The newest assistant reply in a chat, or null when the agent never answered. */
function lastAssistantReply(chatSessionId: string): string | null {
  for (const evt of listRecentChatEvents(chatSessionId, 50)) {
    if (evt.role === 'assistant' && evt.source === 'agent' && evt.content) return evt.content;
  }
  return null;
}

/**
 * Settle a completed heartbeat run: when its final reply is the quiet token
 * and it recorded no changes, label the run quiet and archive its chat.
 * Returns true when the run was quiet. A run that changed anything is never
 * quiet, even if it replied with the token: its changes still need a report.
 */
export function settleHeartbeatRun(runId: string, chatSessionId: string): boolean {
  const run = getRun(runId);
  if (!run || run.triggerId !== RESERVED_TRIGGER_IDS.heartbeat) return false;
  if (run.status !== 'completed') return false;
  if ((run.artifactRefs ?? []).length > 0) return false;
  if (!isQuietReply(lastAssistantReply(chatSessionId))) return false;

  updateRun(runId, { statusReason: HEARTBEAT_QUIET_REASON, summary: HEARTBEAT_QUIET_SUMMARY });
  archiveChatSession(chatSessionId);
  return true;
}

/** True when a run is a quiet heartbeat check-in (nothing to report, nothing to deliver). */
export function isQuietHeartbeatRun(run: { statusReason: string | null }): boolean {
  return run.statusReason === HEARTBEAT_QUIET_REASON;
}
