/**
 * Toggle "keep Flow reachable" auto-tunnel.
 *
 *   POST { enabled: boolean } → { tunnel, lan, local, autoTunnel }
 *
 * Enabling requires a beamd login (auto-reconnect re-opens a beamd tunnel —
 * there's nothing to re-open without one) and opens the tunnel immediately so
 * the machine is reachable NOW, not just after the next restart. The boot
 * loop in `src/lib/auth/auto-tunnel.ts` keeps it alive from then on.
 *
 * Disabling just stops the boot re-open; any live tunnel is left up for the
 * rest of this session.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import {
  getRemoteBaseUrl,
  getLanBaseUrl,
  getLocalBaseUrl,
  getAutoTunnel,
  setAutoTunnel,
  getRunningPort,
  setRunningPort,
} from '@/lib/auth/bootstrap';
import { DEFAULT_PORT, DEV_PORT } from '@/lib/auth/port';
import { openAndSaveBeamdBaseUrl } from '@/lib/auth/beamd-base-url';
import { beamdConnectedServer, BeamdCliError } from '@/lib/preview/beamd/cli';

export const runtime = 'nodejs';

const bodySchema = z.object({ enabled: z.boolean() });

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
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'enabled must be a boolean' },
      { status: 400 },
    );
  }

  // Turning off: stop the boot re-open, leave any live tunnel as-is.
  if (!parsed.data.enabled) {
    setAutoTunnel(false);
    return NextResponse.json(snapshot());
  }

  // Turning on: require beamd, open now, and persist the flag only once the
  // open succeeds so the switch never reads "on" while unreachable.
  try {
    const server = await beamdConnectedServer();
    if (!server) {
      return NextResponse.json(
        {
          error: 'beamd_not_connected',
          message: 'Connect Beamd on this machine before enabling auto-reconnect.',
        },
        { status: 400 },
      );
    }
    const port = requestPort(request);
    setRunningPort(port);
    await openAndSaveBeamdBaseUrl(port);
    setAutoTunnel(true);
    return NextResponse.json(snapshot());
  } catch (err) {
    // Leave the flag off on failure so state stays truthful.
    setAutoTunnel(false);
    if (err instanceof BeamdCliError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/settings/base-url/auto-tunnel]', err);
    return NextResponse.json(
      {
        error: 'auto_tunnel_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
