/**
 * Waiting for a worker command to finish (P4.2, P4.5): its result once
 * delivered, or its reason when it failed, went stale, was withdrawn, or
 * can't be confirmed. A step that must know the outcome before going on
 * (a transfer, a push the person is waiting on) waits here.
 */

import { getDevice, getWorkerCommand } from '@/lib/db/queries';

export class CommandFailedError extends Error {
  constructor(
    message: string,
    readonly result: unknown = null,
  ) {
    super(message);
    this.name = 'CommandFailedError';
  }
}

export async function awaitWorkerCommand(commandId: string, timeoutMs: number, what: string): Promise<unknown> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const command = getWorkerCommand(commandId);
    if (!command) throw new CommandFailedError(`${what} was lost.`);
    if (command.state === 'delivered') return command.result;
    if (command.state === 'failed' || command.state === 'stale' || command.state === 'cancelled' || command.state === 'uncertain') {
      throw new CommandFailedError(command.error ?? `${what} didn't finish.`, command.result);
    }
    if (Date.now() > deadline) {
      throw new CommandFailedError(`${what} didn't finish in time on ${getDevice(command.deviceId)?.name ?? 'its device'}.`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}
