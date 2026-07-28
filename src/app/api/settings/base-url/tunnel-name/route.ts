/**
 * Set the beamd tunnel name this machine's app tunnel opens under.
 *
 *   POST { name: string | null } → BaseUrlSnapshot & { reopened, closedPrevious }
 *
 * `null` (or an empty string) reverts to the default derived from the app
 * short id. The default is identical on every install, so a second machine on
 * the same beamd account can't open it — that collision (`name_taken`) is the
 * whole reason this exists.
 *
 * Rename is transactional in the order that matters: the new name is opened
 * FIRST (when a tunnel was already live, or auto-reconnect is on), so a name
 * that's also taken fails with nothing persisted and the old tunnel still up.
 * Only after a successful open do we persist and tear the old tunnel down.
 */

import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { getAutoTunnel, setRunningPort, setTunnelName } from '@/lib/auth/bootstrap';
import { baseUrlSnapshot as snapshot } from '@/lib/auth/base-url-snapshot';
import { portFromRequestUrl } from '@/lib/auth/port';
import {
  appBeamdTunnelName,
  normalizeTunnelName,
  resolveBeamdTunnelName,
  tunnelNameIsEnvLocked,
  openAndSaveBeamdBaseUrl,
  TUNNEL_NAME_ENV,
} from '@/lib/auth/beamd-base-url';
import { isValidPreviewLabel, MAX_LABEL_LENGTH } from '@/lib/preview/preview-name';
import {
  beamdClose,
  beamdConnectedServer,
  beamdList,
  BeamdCliError,
} from '@/lib/preview/beamd/cli';

export const runtime = 'nodejs';

const bodySchema = z.object({ name: z.string().nullable() });

export async function POST(request: NextRequest) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'invalid_body', message: 'name must be a string or null' },
      { status: 400 },
    );
  }

  if (tunnelNameIsEnvLocked()) {
    return NextResponse.json(
      {
        error: 'tunnel_name_env_locked',
        message: `${TUNNEL_NAME_ENV} is set on this server, so it decides the tunnel name. Unset it to edit the name here.`,
      },
      { status: 400 },
    );
  }

  const custom = normalizeTunnelName(parsed.data.name ?? '');
  if (custom && !isValidPreviewLabel(custom)) {
    return NextResponse.json(
      {
        error: 'invalid_tunnel_name',
        message: `Use letters, numbers and hyphens only (no dots or spaces), up to ${MAX_LABEL_LENGTH} characters, not starting or ending with a hyphen.`,
      },
      { status: 400 },
    );
  }

  const previous = appBeamdTunnelName();
  const next = resolveBeamdTunnelName(custom || null);

  if (previous === next) {
    setTunnelName(custom || null);
    return NextResponse.json({ ...snapshot(), reopened: null, closedPrevious: null });
  }

  // Only this machine's live tunnels — never close a name another machine owns.
  const connected = await beamdConnectedServer().catch(() => null);
  const liveHere = connected
    ? !!(await beamdList().catch(() => [])).find((t) => t.name === previous)
    : false;
  const shouldReopen = !!connected && (liveHere || getAutoTunnel());

  try {
    let reopened: { url: string; name: string } | null = null;
    if (shouldReopen) {
      const port = portFromRequestUrl(request.url);
      setRunningPort(port);
      const opened = await openAndSaveBeamdBaseUrl(port, { name: next });
      reopened = { url: opened.url, name: opened.name };
    }

    setTunnelName(custom || null);

    // Best-effort: a rename shouldn't leave the old label parked on this edge.
    let closedPrevious: string | null = null;
    if (liveHere) {
      const removed = await beamdClose(previous).catch(() => null);
      if (removed) closedPrevious = previous;
    }

    return NextResponse.json({ ...snapshot(), reopened, closedPrevious });
  } catch (err) {
    if (err instanceof BeamdCliError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/settings/base-url/tunnel-name]', err);
    return NextResponse.json(
      {
        error: 'tunnel_name_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
