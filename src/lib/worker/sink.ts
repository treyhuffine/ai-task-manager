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
   * than the one it has when they arrive: the generation of the send whose
   * run produced them, when known. Null for a chat without an execution.
   */
  generationOf?: (chatSessionId: string, runId: string | null) => number | null;
  /** The run producing a chat's output: that of the message whose turn it is. Its cost goes there. */
  runOf?: (chatSessionId: string) => string | null;
  /** The generation of the send that started a turn, for its result. */
  turnGeneration?: (turnId: string) => number | null | undefined;
  /** A turn's result was journaled. */
  onTurnEnded?: (turnId: string) => void;
  /** Called after each append, to post soon. */
  onAppend?: () => void;
}

export function createWorkerSink({
  journal,
  generationOf = () => null,
  runOf = () => null,
  turnGeneration = () => undefined,
  onTurnEnded,
  onAppend,
}: WorkerSinkOptions): RunnerSink {
  const journalChatEvent = (row: CreateChatEventInput, cumulative: boolean) => {
    const { id, sessionId, ...chatEvent } = row;
    const runId = runOf(sessionId);
    journal.append({
      kind: 'chat_event',
      // The id is minted here, when the worker parsed it, so a replay of this
      // journal entry inserts nothing new at home.
      eventId: id ?? uuidv7(),
      chatSessionId: sessionId,
      generation: generationOf(sessionId, runId),
      runId,
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
        // A turn's result carries its own send's generation, whatever has
        // arrived for the chat since.
        generation:
          (signal.type === 'turn_result' ? turnGeneration(signal.turnId) : undefined)
          ?? generationOf(chatSessionId, runOf(chatSessionId)),
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
