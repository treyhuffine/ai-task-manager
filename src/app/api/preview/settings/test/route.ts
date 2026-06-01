/**
 * "Test connection" for beamd settings.
 *
 * Uses `beamd check --json` (0.0.2+): authenticates against the edge and
 * reports `{ ok, server, slug, baseDomain }` **without** registering a tunnel
 * or spawning the persistent agent. Unlike `status`, a valid config returns
 * `ok:true` even on first setup (status reports `healthy:false` until a tunnel
 * exists, which made good configs look broken).
 */

import { beamdCheck, BeamdCliError, setBeamdBinOverride } from '@/lib/preview/beamd/cli';
import { beamdConfigExists } from '@/lib/preview/beamd/config';
import { readPreviewSettings } from '@/lib/preview/settings';

export const runtime = 'nodejs';

export async function POST() {
  if (!beamdConfigExists()) {
    return Response.json(
      { error: 'beamd_not_configured', message: 'Enter a beamd server and token first.' },
      { status: 400 },
    );
  }
  setBeamdBinOverride(readPreviewSettings().beamdBinPath);
  try {
    const check = await beamdCheck();
    return Response.json({ ok: true, server: check.server, slug: check.slug, baseDomain: check.baseDomain });
  } catch (err) {
    if (err instanceof BeamdCliError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/preview/settings/test]', err);
    return Response.json({ error: 'beamd_test_failed', message: String(err) }, { status: 500 });
  }
}
