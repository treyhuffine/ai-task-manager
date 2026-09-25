/**
 * EventWriter — the seam between the executor and chat_events persistence.
 *
 * Nothing that parses provider events calls `insertChatEvent` directly; it
 * writes through this interface (defined with the runner, in
 * `src/lib/runner/types.ts`). This is the plain database writer, used by
 * transcript replay on the home. A live session writes through the home
 * sink's writer, which adds run telemetry, and a connected computer's
 * worker writes to its journal (docs/homes-build.md, P2).
 */

import { insertChatEvent, replaceChatEventPart } from '@/lib/db/queries';
import type { EventWriter } from '@/lib/runner/types';

export type { EventWriter } from '@/lib/runner/types';

/**
 * Default v1 writer. Calls into the queries layer's idempotent insert.
 * `insertChatEvent` already bumps the session's `lastOutcomeEventAt`
 * for `agent` / `result` source rows, so we don't have to track that
 * here.
 */
export const localEventWriter: EventWriter = {
  async write(event) {
    return insertChatEvent(event) !== null;
  },
  async replacePart(event) {
    replaceChatEventPart(event);
  },
};
