/**
 * Turning off a device's local execution (docs/homes-build.md, P2.8): from
 * the device (`ri worker disable`), or by the owner revoking its worker
 * key. Revoking the key alone left its work hanging: queued commands waited
 * forever, sent ones stayed sent, and its runs stayed running with nobody
 * left to report them. So in one transaction with the revocation, its
 * queued commands are cancelled, its sent ones become uncertain, and its
 * runs still under way fail with the reason, their waiting turns settled.
 * Then its stream closes and its live state leaves the home's mirror.
 *
 * The worker, told it's revoked, stops and closes its sessions. One that's
 * offline stops when it next reaches the home and is refused.
 */

import type { ApiKeyRecord } from '@/db/types';
import { deliveredSendsWithOpenRuns, getDevice, retireDeviceCommands, revokeApiKey } from '@/lib/db/queries';
import { inTransaction } from '@/lib/effects/after-commit';
import { clearDeviceMirror } from '@/lib/executor/remote-live';
import { settleTurn } from '@/lib/executor/turns';
import { finishRunInTransaction } from '@/lib/runs/finish';
import { disconnectDevice } from './hub';
import { settleUndelivered } from './undelivered';

export function retireWorker(apiKeyId: string, deviceId: string, reason: string): ApiKeyRecord | null {
  const message = `Local execution on ${getDevice(deviceId)?.name ?? 'this device'} was turned off.`;
  const revoked = inTransaction((after) => {
    const row = revokeApiKey(apiKeyId, reason);
    if (!row) return null;
    for (const command of retireDeviceCommands(deviceId)) settleUndelivered(command, after);
    for (const send of deliveredSendsWithOpenRuns(deviceId)) {
      const { runId, turnId } = (send.payload ?? {}) as { runId?: string | null; turnId?: string };
      if (runId) finishRunInTransaction(runId, { ok: false, errorCode: 'device_turned_off', errorMessage: message }, after);
      if (turnId) after.tasks.push(() => settleTurn(turnId, message));
    }
    return row;
  });
  if (revoked) {
    disconnectDevice(deviceId, message);
    clearDeviceMirror(deviceId);
  }
  return revoked;
}
