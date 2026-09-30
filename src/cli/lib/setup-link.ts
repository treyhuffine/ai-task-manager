/**
 * This computer, as its home knows it, for `ri setup` (docs/homes-spec.md
 * §4.1). On a home, its own computer. On a connected computer, registered
 * with the home under its key the first time, and remembered.
 */

import { getInstallationRole } from '@/lib/config/role';
import { readConnection, rememberComputerId, rememberedComputerId, writeConnection } from '@/lib/connection/config';
import { thisComputerFacts } from '@/lib/home/computer-name';
import type { DispatchEnvelope } from '@/lib/orchestrator/dispatch';
import { dispatchAction } from './dispatch';

export class SetupCommandError extends Error {}

export function unwrap<T>(envelope: DispatchEnvelope): T {
  if (!envelope.ok) throw new SetupCommandError(envelope.error?.message ?? `The home refused ${envelope.action}.`);
  return envelope.result as T;
}

/** This computer's id at its home: registering it there the first time. */
export async function thisComputerId(): Promise<string> {
  if (getInstallationRole() === 'home') {
    const { ensureHomeIdentity } = await import('@/lib/home/identity');
    return ensureHomeIdentity().computer.id;
  }
  const connection = readConnection();
  if (!connection) throw new SetupCommandError('This computer is not connected to a home.');
  if (connection.computerId) return connection.computerId;
  const { computer } = unwrap<{ computer: { id: string } }>(
    await dispatchAction('register_computer', { ...thisComputerFacts(), computerId: rememberedComputerId(connection.homeId) }),
  );
  writeConnection({ ...connection, computerId: computer.id });
  rememberComputerId(connection.homeId, computer.id);
  return computer.id;
}
