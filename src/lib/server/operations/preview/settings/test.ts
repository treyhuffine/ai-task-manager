import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * "Test connection" — `beamd check --json` authenticates the machine's beamd
 * account against the edge (no tunnel registered, no agent spawned) and
 * reports `{ server, slug, baseDomain }`. Resolves the same `~/.beamd/`
 * account everything else uses; Ri passes no `--config`.
 */

import { beamdBinInfo, beamdCheck, BeamdCliError } from '@/lib/preview/beamd/cli';

export async function POST(_rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const check = await beamdCheck();
    const bin = await beamdBinInfo().catch(() => null);
    return reply({ ok: true, server: check.server, slug: check.slug, baseDomain: check.baseDomain, bin });
  } catch (err) {
    if (err instanceof BeamdCliError) {
      return reply({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/preview/settings/test]', err);
    return reply({ error: 'beamd_test_failed', message: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({}).strict().default({}) }).strict();
