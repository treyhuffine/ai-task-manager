import { HARNESS_REGISTRY } from '@/lib/harness/registry';
import { getHarnessRateLimits } from '@/lib/harness/rate-limits';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** The latest account rate limits each harness reported, for the top bar's rate limits pill. */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  return reply({
    harnesses: getHarnessRateLimits().map((entry) => ({ ...entry, name: HARNESS_REGISTRY[entry.harness].name })),
  });
}

export const GETInput = rpcZ.object({}).strict().default({});
