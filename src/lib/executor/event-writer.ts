/**
 * EventWriter — the seam between the executor and chat_events persistence.
 *
 * The executor parser doesn't call `insertChatEvent` directly; it writes
 * through this interface. v1 has one implementation that stays in-process
 * and writes to the local DB. When cross-machine execution lands (see
 * `docs/workspaces-spec.md` §"Deferred: cross-machine execution"), a
 * `RemoteEventWriter` POSTs events to the canonical server's API
 * instead. Same parser, swap the writer.
 *
 * Cost today: ~10 lines. Cost of retrofitting later if we'd called
 * insertChatEvent inline: rewriting the executor's inner loop.
 */

import { insertChatEvent } from '@/lib/db/queries';
import type { CreateChatEventInput } from '@/db/types';

export interface EventWriter {
  write(event: CreateChatEventInput): Promise<void>;
}

/**
 * Default v1 writer. Calls into the queries layer's idempotent insert.
 * `insertChatEvent` already bumps the session's `lastOutcomeEventAt`
 * for `agent` / `result` source rows, so we don't have to track that
 * here.
 */
export const localEventWriter: EventWriter = {
  async write(event) {
    insertChatEvent(event);
  },
};
