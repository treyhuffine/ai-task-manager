/**
 * This device, as its home knows it, for `ri setup` (docs/homes-spec.md
 * §4.1). On a home, its own device. On a connected device, registered
 * with the home under its key the first time, and remembered.
 */

import { getInstallationRole } from '@/lib/config/role';
import { readConnection, rememberDeviceId, rememberedDeviceId, writeConnection } from '@/lib/connection/config';
import { thisDeviceFacts } from '@/lib/home/device-name';
import type { DispatchEnvelope } from '@/lib/orchestrator/dispatch';
import { dispatchAction } from './dispatch';

export class SetupCommandError extends Error {}

export function unwrap<T>(envelope: DispatchEnvelope): T {
  if (!envelope.ok) throw new SetupCommandError(envelope.error?.message ?? `The home refused ${envelope.action}.`);
  return envelope.result as T;
}

/** This device's id at its home: registering it there the first time. */
export async function thisDeviceId(): Promise<string> {
  if (getInstallationRole() === 'home') {
    const { ensureHomeIdentity } = await import('@/lib/home/identity');
    return ensureHomeIdentity().device.id;
  }
  const connection = readConnection();
  if (!connection) throw new SetupCommandError('This device is not connected to a home.');
  if (connection.deviceId) return connection.deviceId;
  const { device } = unwrap<{ device: { id: string } }>(
    await dispatchAction('register_device', { ...thisDeviceFacts(), deviceId: rememberedDeviceId(connection.homeId) }),
  );
  writeConnection({ ...connection, deviceId: device.id });
  rememberDeviceId(connection.homeId, device.id);
  return device.id;
}
