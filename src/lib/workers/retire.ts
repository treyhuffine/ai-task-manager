/**
 * Turning off a computer's local execution (docs/homes-build.md, P2.8): from
 * the computer (`ri worker disable`), or by the owner revoking its worker
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
import { deliveredSendsWithOpenRuns, getComputer, retireComputerCommands, revokeApiKey } from '@/lib/db/queries';
import { inTransaction } from '@/lib/effects/after-commit';
import { clearComputerMirror } from '@/lib/executor/remote-live';
import { settleTurn } from '@/lib/executor/turns';
import { finishRunInTransaction } from '@/lib/runs/finish';
import { disconnectComputer } from './hub';
import { settleUndelivered } from './undelivered';

export function retireWorker(apiKeyId: string, computerId: string, reason: string): ApiKeyRecord | null {
  const message = `Local execution on ${getComputer(computerId)?.name ?? 'this computer'} was turned off.`;
  const revoked = inTransaction((after) => {
    const row = revokeApiKey(apiKeyId, reason);
    if (!row) return null;
    for (const command of retireComputerCommands(computerId)) settleUndelivered(command, after);
    for (const send of deliveredSendsWithOpenRuns(computerId)) {
      const { runId, turnId } = (send.payload ?? {}) as { runId?: string | null; turnId?: string };
      if (runId) finishRunInTransaction(runId, { ok: false, errorCode: 'computer_turned_off', errorMessage: message }, after);
      if (turnId) after.tasks.push(() => settleTurn(turnId, message));
    }
    return row;
  });
  if (revoked) {
    disconnectComputer(computerId, message);
    clearComputerMirror(computerId);
  }
  return revoked;
}
