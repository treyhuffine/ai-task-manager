/**
 * The home's runner sink: what the home's own runner reports, applied to the
 * home's records (docs/homes-build.md, P2.1 and P2.3).
 *
 * Each event and signal is applied in its own transaction through the same
 * functions a connected device's journaled events go through
 * (`apply.ts`), so every placement behaves the same way. There's no journal
 * here, because there's no network in between.
 */

import { getTeamChat, runningTeamChatTurn } from '@/lib/db/queries';
import { producingRun } from '@/lib/runner/local-runner';
import { installRunnerSink } from '@/lib/runner/sink';
import type { EventWriter, RunnerSink } from '@/lib/runner/types';
import { inTransaction } from '@/lib/effects/after-commit';
import { applyChatEvent, applyRunnerSignal } from './apply';
import { recordRateLimits } from '@/lib/harness/rate-limits';

/**
 * Chat events from a live session: inserted by id, or a cumulative part
 * replacing an older revision. A result is charged to the run of the message
 * whose turn produced it, and otherwise to the chat's active run here.
 */
const liveWriter: EventWriter = {
  async write(event) {
    const runId = producingRun(event.sessionId);
    return inTransaction(() => applyChatEvent(withTeamTurn(event), { cumulative: false, runId }));
  },
  async replacePart(event) {
    inTransaction(() => applyChatEvent(withTeamTurn(event), { cumulative: true, runId: producingRun(event.sessionId) }));
  },
};

export const homeSink: RunnerSink = {
  writer: liveWriter,
  rateLimits: recordRateLimits,
  signal(chatSessionId, signal) {
    inTransaction((after) => applyRunnerSignal(chatSessionId, signal, after));
  },
};

/** Install the home sink for the local runner. Idempotent. */
export function installHomeSink(): void {
  installRunnerSink(homeSink);
}

/** Provider output keeps its producing turn even when another send is queued. */
function withTeamTurn<T extends Parameters<EventWriter['write']>[0]>(event: T): T {
  if (!getTeamChat(event.sessionId)) return event;
  const previous = event.raw && typeof event.raw === 'object' ? event.raw : {};
  return { ...event, raw: { ...previous, riTeamTurnId: runningTeamChatTurn(event.sessionId)?.id ?? null } };
}
