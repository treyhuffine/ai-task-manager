import { homeSettingsAdmission } from '@/lib/home/settings-authority';
import { HARNESS_REGISTRY } from '@/lib/harness/registry';
import { getHarnessRateLimits, rateLimitsNeedRead, readHarnessRateLimits, type HarnessRateLimits } from '@/lib/harness/rate-limits';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

const named = (entries: HarnessRateLimits[]) => entries.map((entry) => ({ ...entry, name: HARNESS_REGISTRY[entry.harness].name }));

/**
 * The latest account rate limits each harness reported, for the top bar's rate limits pill.
 * `stale` says the visible-page refresh should ask for a fresh read (POST).
 */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const homeDenied = homeSettingsAdmission(_request.headers, 'manageSignIns');
  if (homeDenied) return homeDenied;
  return reply({ harnesses: named(getHarnessRateLimits()), stale: rateLimitsNeedRead() });
}

/** Read due harnesses outside a chat, at most once every two minutes each. */
export async function POST(_rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const homeDenied = homeSettingsAdmission(_request.headers, 'manageSignIns');
  if (homeDenied) return homeDenied;
  return reply({ harnesses: named(await readHarnessRateLimits()), stale: false });
}

export const GETInput = rpcZ.object({}).strict().default({});
export const POSTInput = rpcZ.object({}).strict().default({});
