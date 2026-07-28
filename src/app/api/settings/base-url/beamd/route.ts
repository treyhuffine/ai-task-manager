import type { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import {
  getRemoteBaseUrl,
  getLanBaseUrl,
  getLocalBaseUrl,
  getRunningPort,
  setRunningPort,
  getAutoTunnel,
} from '@/lib/auth/bootstrap';
import { DEFAULT_PORT, DEV_PORT } from '@/lib/auth/port';
import { openAndSaveBeamdBaseUrl } from '@/lib/auth/beamd-base-url';
import { BeamdCliError } from '@/lib/preview/beamd/cli';
import { invalidateConnectorRuntime } from '@/lib/connectors/runtime';

export const runtime = 'nodejs';

function snapshot() {
  return {
    tunnel: getRemoteBaseUrl(),
    lan: getLanBaseUrl(),
    local: getLocalBaseUrl(),
    autoTunnel: getAutoTunnel(),
  };
}

function requestPort(request: NextRequest): number {
  const envPort = Number(process.env.PORT);
  if (Number.isFinite(envPort) && envPort > 0) return envPort;

  const urlPort = Number(new URL(request.url).port);
  if (Number.isFinite(urlPort) && urlPort > 0) return urlPort;

  const fallback = process.env.NODE_ENV === 'development' ? DEV_PORT : DEFAULT_PORT;
  return getRunningPort(fallback);
}

export async function POST(request: NextRequest) {
  try {
    const port = requestPort(request);
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
