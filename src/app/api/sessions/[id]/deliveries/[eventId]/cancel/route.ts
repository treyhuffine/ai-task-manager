import type { NextRequest } from 'next/server';
import { cancelWorkerCommand, getComputer, getSendForEvent } from '@/lib/db/queries';
import { inTransaction } from '@/lib/effects/after-commit';
import { deliveryOf } from '@/lib/workers/delivery';
import { settleUndelivered } from '@/lib/workers/undelivered';

export const dynamic = 'force-dynamic';

/**
 * Withdraw a message still waiting in its computer's queue (P3.2). Only one
 * that hasn't crossed the delivery boundary: once it's been streamed to the
 * worker it may be running, and only stopping the execution can prevent
 * that. Its run is finished and its turn settled with it, and it shows as
 * not delivered.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string; eventId: string }> },
) {
  const { id, eventId } = await params;
  const send = getSendForEvent(eventId);
  if (!send || send.chatSessionId !== id) {
    return Response.json({ error: 'not_found', message: 'That message has nothing waiting to withdraw.' }, { status: 404 });
  }
  const onItsWay = () => {
    const name = getComputer(send.computerId)?.name ?? 'its computer';
    return Response.json(
      { error: 'on_its_way', message: `It's already on its way to ${name}. Stop the execution to keep it from running.` },
      { status: 409 },
    );
  };
  if (send.state === 'sent') return onItsWay();
  if (send.state !== 'queued') {
    return Response.json({ error: 'not_waiting', message: "It isn't waiting any more." }, { status: 409 });
  }
  const withdrawn = inTransaction((after) => {
    const cancelled = cancelWorkerCommand(send.id);
    if (cancelled) settleUndelivered(cancelled, after);
    return cancelled;
  });
  // Streamed meanwhile: too late to withdraw.
  if (!withdrawn) return onItsWay();
  return Response.json(deliveryOf(withdrawn));
}
