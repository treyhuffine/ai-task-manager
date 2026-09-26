/**
 * A command that won't be carried out: its worker acknowledged it failed,
 * stale or uncertain, the home found it stale before sending it, or it was
 * withdrawn (cancelled) before it left. A send
 * among them never produces a turn result, so its run is finished and its
 * turn settled here, in the caller's transaction (P2.4, P2.6).
 */

import type { WorkerCommandRecord } from '@/db/types';
import type { AfterCommit } from '@/lib/effects/after-commit';
import { settleTurn } from '@/lib/executor/turns';
import { finishRunInTransaction } from '@/lib/runs/finish';
import { announceDelivery } from './delivery';

const UNDELIVERED: Record<string, { code: string; message: string }> = {
  failed: { code: 'delivery_failed', message: "The message couldn't be delivered." },
  stale: { code: 'placement_moved', message: 'The execution had moved to another computer.' },
  uncertain: { code: 'delivery_uncertain', message: 'Message delivery could not be confirmed.' },
  cancelled: { code: 'delivery_cancelled', message: 'The message was withdrawn before it was delivered.' },
};

export function settleUndelivered(command: WorkerCommandRecord, after: AfterCommit): void {
  const undelivered = UNDELIVERED[command.state];
  if (command.kind !== 'send' || !undelivered) return;
  const payload = (command.payload ?? {}) as { runId?: string | null; turnId?: string };
  const message = command.error ?? undelivered.message;
  if (payload.runId) finishRunInTransaction(payload.runId, { ok: false, errorCode: undelivered.code, errorMessage: message }, after);
  if (payload.turnId) after.tasks.push(() => settleTurn(payload.turnId!, message));
  // Its message shows as not delivered, or uncertain, once this commits (P3.2).
  after.tasks.push(() => announceDelivery(command.id));
}
