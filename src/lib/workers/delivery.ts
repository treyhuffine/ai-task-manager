/**
 * Where a message sent to a computer elsewhere stands (docs/homes-spec.md
 * §3.5, P3.2). Saving it at the home is not delivering it to the harness, so
 * each message a chat elsewhere sends carries its own state, from its send
 * command:
 *
 *   waiting        saved at the home, its computer not connected
 *   sending        on its way: queued while connected, or streamed and not
 *                  yet acknowledged
 *   delivered      the harness has it
 *   not_delivered  failed, withdrawn, or the execution moved first
 *   uncertain      it may or may not have reached the harness, and the
 *                  worker couldn't tell from the native history
 *   held           saved while the execution moves to another computer
 *                  (P4.2), and sent once, where it ends up
 *
 * Every change is announced on the chat's stream after it commits, from the
 * places a send changes state: queued by dispatch, streamed to the worker,
 * acknowledged, withdrawn, found stale, uncertain after re-enrollment, or
 * settled when local execution is turned off. A computer connecting or
 * dropping changes what its open sends say, so that's announced too.
 */

import type { WorkerCommandRecord } from '@/db/types';
import { getChatEventById, getChatSession, getComputer, getWorkerCommand, heldMessages, listOpenSendsForComputer, listSendsForChat } from '@/lib/db/queries';
import { publishDelivery } from '@/lib/realtime/bus';
import { isComputerConnected } from './hub';

export type DeliveryState = 'waiting' | 'sending' | 'delivered' | 'not_delivered' | 'uncertain' | 'held';

export interface MessageDelivery {
  state: DeliveryState;
  computerId: string;
  /** The computer's name, as the person named it. */
  computerName: string;
  /** Its worker is connected now. */
  connected: boolean;
  /** Why it wasn't delivered, or why delivery can't be confirmed. */
  reason: string | null;
  /** Still in the home's queue, so it can be withdrawn. */
  cancellable: boolean;
}

const NOT_DELIVERED: Record<string, string> = {
  failed: "It couldn't be delivered.",
  cancelled: 'It was withdrawn before it was delivered.',
  stale: 'The execution moved to another computer first.',
};

export function deliveryOf(command: WorkerCommandRecord): MessageDelivery | null {
  if (command.kind !== 'send') return null;
  const connected = isComputerConnected(command.computerId);
  const base = {
    computerId: command.computerId,
    computerName: getComputer(command.computerId)?.name ?? 'the other computer',
    connected,
    reason: null,
    cancellable: false,
  };
  switch (command.state) {
    case 'queued':
      return { ...base, state: connected ? 'sending' : 'waiting', cancellable: true };
    case 'sent':
      return { ...base, state: 'sending' };
    case 'delivered':
      return { ...base, state: 'delivered' };
    case 'uncertain':
      return { ...base, state: 'uncertain', reason: command.error ?? 'Its computer restarted before confirming it.' };
    default:
      return { ...base, state: 'not_delivered', reason: command.error ?? NOT_DELIVERED[command.state] ?? null };
  }
}

/** Every message the chat sent to a computer elsewhere, or that a move holds, by its chat event id. */
export function deliveriesForChat(chatSessionId: string): Record<string, MessageDelivery> {
  const out: Record<string, MessageDelivery> = {};
  for (const command of listSendsForChat(chatSessionId)) {
    const delivery = command.sourceEventId ? deliveryOf(command) : null;
    if (delivery) out[command.sourceEventId!] = delivery;
  }
  const executionId = getChatSession(chatSessionId)?.executionId;
  if (executionId) {
    for (const [eventId, { transfer }] of heldMessages(executionId)) {
      if (getChatEventById(eventId)?.sessionId !== chatSessionId) continue;
      out[eventId] = heldDelivery(transfer);
    }
  }
  return out;
}

/** A message a move holds (P4.2). If the move stopped, why, and it waits for Try again or Resume. */
function heldDelivery(transfer: { toComputerId: string; fromComputerId: string; state: string; toGeneration: number | null }): MessageDelivery {
  const to = getComputer(transfer.toComputerId)?.name ?? 'the other computer';
  const from = getComputer(transfer.fromComputerId)?.name ?? 'the other computer';
  return {
    state: 'held',
    computerId: transfer.toComputerId,
    computerName: to,
    connected: isComputerConnected(transfer.toComputerId),
    reason:
      transfer.state === 'failed'
        ? transfer.toGeneration === null
          ? `The move to ${to} stopped. Try again, or resume on ${from}.`
          : `The move to ${to} stopped after it arrived. Deliver it there to finish.`
        : null,
    cancellable: false,
  };
}

/** A message a move just took (P4.2). */
export function announceHeld(chatSessionId: string, eventId: string): void {
  const executionId = getChatSession(chatSessionId)?.executionId;
  const held = executionId ? heldMessages(executionId).get(eventId) : undefined;
  if (held) publishDelivery(chatSessionId, eventId, heldDelivery(held.transfer));
}

/** Announce a send's state on its chat's stream. Call after the change commits. */
export function announceDelivery(command: WorkerCommandRecord | string | null | undefined): void {
  const record = typeof command === 'string' ? getWorkerCommand(command) : command;
  if (!record || record.kind !== 'send' || !record.chatSessionId || !record.sourceEventId) return;
  const delivery = deliveryOf(record);
  if (delivery) publishDelivery(record.chatSessionId, record.sourceEventId, delivery);
}

/** A computer connected or dropped: what its open sends say changes. */
export function announceOpenSends(computerId: string): void {
  for (const command of listOpenSendsForComputer(computerId)) announceDelivery(command);
}
