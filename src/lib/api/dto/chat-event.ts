/**
 * Wire shape for a chat event.
 *
 * `chat_events.raw` is the provider's original payload, kept for
 * forward-compatibility. It is also 80% of every transcript page: measured on
 * a real 100-row page, `raw` was 424.8KB of 529KB, and across the whole table
 * it is 1.44GB against 68MB of `content`. Almost none of it is read.
 *
 * Only three things ever look at `raw`:
 *
 *   - the transcript reads `raw.subtype` (and only as a fallback behind
 *     `content`, for `system` rows)
 *   - the execution HUD reads `raw.usage` on `result` rows and `raw.model` on
 *     `system` rows, for the token counter and model label
 *   - `decodeBackgroundTaskEvent` reads the whole object, but returns null
 *     for anything that isn't a background-task envelope
 *
 * So the first two become derived scalars, and `raw` survives only where the
 * decoder can actually use it. The condition is expressed *as* a decoder call
 * rather than by re-testing `type`/`providerType` here: that keeps this
 * projection exactly in step with the decoder's own rules, so a row that used
 * to decode still decodes and a row that didn't still returns null. If the
 * decoder ever learns a new envelope, this follows automatically.
 *
 * Measured effect: `raw` is retained on 26.5% of rows and 97.4% of its bytes
 * are dropped.
 */

import type { ChatEventRecord } from '@/db/types';
import { decodeBackgroundTaskEvent } from '@/lib/executor/background-task-event';

export type ChatEventDTO = Omit<ChatEventRecord, 'raw'> & {
  /** Provider payload, present only when it is actually decodable. */
  raw: ChatEventRecord['raw'] | null;
  /** `raw.subtype`, lifted so the transcript never needs the full object. */
  rawSubtype: string | null;
  /** `raw.model` — the active model id, read off `system` rows by the HUD. */
  rawModel: string | null;
  /** `raw.usage` — token counts, read off `result` rows by the HUD. */
  rawUsage: unknown;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null;
}

/** Project one row onto the wire shape. */
export function toChatEventDTO(row: ChatEventRecord): ChatEventDTO {
  const raw = asRecord(row.raw);
  return {
    ...row,
    raw: decodeBackgroundTaskEvent(row.raw) ? row.raw : null,
    rawSubtype: str(raw?.subtype),
    rawModel: str(raw?.model),
    rawUsage: raw?.usage ?? null,
  };
}

export function toChatEventDTOs(rows: readonly ChatEventRecord[]): ChatEventDTO[] {
  return rows.map(toChatEventDTO);
}
