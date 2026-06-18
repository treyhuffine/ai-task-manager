/**
 * "Test connection" — `beamd check --json` authenticates the machine's beamd
 * account against the edge (no tunnel registered, no agent spawned) and
 * reports `{ server, slug, baseDomain }`. Resolves the same `~/.beamd/`
 * account everything else uses; Flow passes no `--config`.
 */

import { beamdCheck, beamdBinInfo, BeamdCliError } from '@/lib/preview/beamd/cli';

export const runtime = 'nodejs';

export async function POST() {
  try {
    const check = await beamdCheck();
    const bin = await beamdBinInfo().catch(() => null);
    return Response.json({ ok: true, server: check.server, slug: check.slug, baseDomain: check.baseDomain, bin });
  } catch (err) {
    if (err instanceof BeamdCliError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/preview/settings/test]', err);
    return Response.json({ error: 'beamd_test_failed', message: String(err) }, { status: 500 });
  }
}
