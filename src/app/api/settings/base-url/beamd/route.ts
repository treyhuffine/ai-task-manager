import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { setRunningPort } from '@/lib/auth/bootstrap';
import { baseUrlSnapshot as snapshot } from '@/lib/auth/base-url-snapshot';
import { portFromRequestUrl } from '@/lib/auth/port';
import { openAndSaveBeamdBaseUrl } from '@/lib/auth/beamd-base-url';
import { BeamdCliError } from '@/lib/preview/beamd/cli';
import { invalidateConnectorRuntime } from '@/lib/connectors/runtime';

export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const port = portFromRequestUrl(request.url);
    setRunningPort(port);
    const beamd = await openAndSaveBeamdBaseUrl(port);
    // Opening the tunnel changes the externally-reachable URL the connector
    // OAuth redirect derives from — rebuild the runtime so it picks it up.
    invalidateConnectorRuntime();
    return NextResponse.json({ ...snapshot(), beamd });
  } catch (err) {
    if (err instanceof BeamdCliError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/settings/base-url/beamd]', err);
    return NextResponse.json(
      { error: 'beamd_base_url_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
