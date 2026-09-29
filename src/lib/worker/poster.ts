/**
 * Sends the event journal to the home (docs/homes-build.md, P2.3): batches
 * from the last acknowledged position, in order. The home answers with the
 * highest contiguous position it stored, and the next batch starts after it.
 * When the home can't be reached, events wait in the journal. One post at a
 * time, so the order holds.
 */

import { WorkerNetworkError, workerFetch, type WorkerTarget } from './client';
import type { EventJournal } from './event-journal';

export const POST_BATCH = 200;

export class EventPoster {
  private running: Promise<void> | null = null;
  private again = false;

  constructor(
    private readonly target: WorkerTarget,
    private readonly journal: EventJournal,
  ) {}

  /** Post what's pending, now or right after the post in flight. Never throws. */
  kick(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = this.drain().finally(() => {
      this.running = null;
      if (this.again) {
        this.again = false;
        void this.kick();
      }
    });
    return this.running;
  }

  private async drain(): Promise<void> {
    for (;;) {
      const batch = this.journal.pending(POST_BATCH);
      if (batch.length === 0) return;
      // Positions before the first one still here were compacted away after
      // the home acknowledged them. If the home now has fewer (restored from
      // an older backup), say they're gone rather than stall on the gap.
      const gone = batch[0]!.position - 1;
      let res: Response;
      try {
        res = await workerFetch(this.target, '/api/workers/me/events', {
          method: 'POST',
          body: JSON.stringify({ events: batch, gone }),
          timeoutMs: 30_000,
        });
      } catch (err) {
        if (err instanceof WorkerNetworkError) return; // try again on the next kick or reconnect
        throw err;
      }
      if (!res.ok) return;
      const body = (await res.json().catch(() => null)) as { acked?: number } | null;
      if (typeof body?.acked !== 'number') return;
      const before = this.journal.ackedPosition();
      this.journal.ack(body.acked);
      // Nothing moved: the home stopped at a gap it can't fill from this batch.
      if (body.acked <= before && body.acked < batch[0]!.position) return;
    }
  }
}
