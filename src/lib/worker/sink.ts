/**
 * The worker's runner sink (docs/homes-build.md, P2.3): everything the
 * runner on this computer reports goes into the event journal, flushed to
 * disk, and the poster sends it to the home. The same runner code that runs
 * in the home's server reports here instead.
 */

import { uuidv7 } from 'uuidv7';
import type { CreateChatEventInput } from '@/db/types';
import type { RunnerSink } from '@/lib/runner/types';
import type { EventJournal } from './event-journal';

export interface WorkerSinkOptions {
  journal: EventJournal;
  /**
   * The placement generation a chat's events belong to, stamped when they're
   * journaled, so the home judges them by the placement that ran them rather
   * than the one it has when they arrive. Null for a chat without an
   * execution.
   */
  generationOf?: (chatSessionId: string) => number | null;
  /** The run a chat's output belongs to: its open turn's. Its cost goes there. */
  runOf?: (chatSessionId: string) => string | null;
  /** A turn's result was journaled. */
  onTurnEnded?: (turnId: string) => void;
  /** Called after each append, to post soon. */
  onAppend?: () => void;
}

export function createWorkerSink({
  journal,
  generationOf = () => null,
  runOf = () => null,
  onTurnEnded,
  onAppend,
}: WorkerSinkOptions): RunnerSink {
  const journalChatEvent = (row: CreateChatEventInput, cumulative: boolean) => {
    const { id, sessionId, ...chatEvent } = row;
    journal.append({
      kind: 'chat_event',
      // The id is minted here, when the worker parsed it, so a replay of this
      // journal entry inserts nothing new at home.
      eventId: id ?? uuidv7(),
      chatSessionId: sessionId,
      generation: generationOf(sessionId),
      runId: runOf(sessionId),
      occurredAt: row.createdAt ?? new Date().toISOString(),
      chatEvent,
      cumulative,
    });
    onAppend?.();
  };
  return {
    writer: {
      async write(row) {
        journalChatEvent(row, false);
        return true;
      },
      async replacePart(row) {
        journalChatEvent(row, true);
      },
    },
    signal(chatSessionId, signal) {
      journal.append({
        kind: 'signal',
        eventId: uuidv7(),
        chatSessionId,
        generation: generationOf(chatSessionId),
        occurredAt: new Date().toISOString(),
        signal,
      });
      // After the result is on disk: a crash between the two reports the
      // turn once more at worst, which the home ignores once it's finished.
      if (signal.type === 'turn_result') onTurnEnded?.(signal.turnId);
      onAppend?.();
    },
  };
}
