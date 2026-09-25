/**
 * Enrolling a computer's worker (docs/homes-build.md, P2.2), with what that
 * does to the commands its earlier worker left: sent and never
 * acknowledged, they become uncertain, since they may have been acted on.
 * A send among them never produces a turn result, so its run is finished
 * and its turn settled in the same transaction.
 */

import { redeemEnrollGrant } from '@/lib/db/queries';
import { inTransaction } from '@/lib/effects/after-commit';
import { settleUndelivered } from './undelivered';

export function enrollWorker(input: Parameters<typeof redeemEnrollGrant>[0]): ReturnType<typeof redeemEnrollGrant> {
  return inTransaction((after) => {
    const enrolled = redeemEnrollGrant(input);
    for (const command of enrolled.uncertain) settleUndelivered(command, after);
    return enrolled;
  });
}
