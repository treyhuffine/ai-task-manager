import { legacySchema } from '@/lib/server/inputs';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Toggle "keep Ri reachable" auto-tunnel.
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

import { baseUrlSnapshot as snapshot } from '@/lib/auth/base-url-snapshot';
import { openAndSaveBeamdBaseUrl } from '@/lib/auth/beamd-base-url';
import { setAutoTunnel, setRunningPort } from '@/lib/auth/bootstrap';
import { portFromRequestUrl } from '@/lib/auth/port';
import { invalidateConnectorRuntime } from '@/lib/connectors/runtime';
import { BeamdCliError, beamdConnectedServer } from '@/lib/preview/beamd/cli';
import { z } from 'zod';

const bodySchema = z.object({ enabled: z.boolean() });

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const parsed = bodySchema.safeParse(rpcInput.body);
  if (!parsed.success) {
    return reply(
      { error: 'invalid_body', message: 'enabled must be a boolean' },
      { status: 400 },
    );
  }

  // Turning off: stop the boot re-open, leave any live tunnel as-is.
  if (!parsed.data.enabled) {
    setAutoTunnel(false);
    return reply(snapshot());
  }

  // Turning on: require beamd, open now, and persist the flag only once the
  // open succeeds so the switch never reads "on" while unreachable.
  try {
    const server = await beamdConnectedServer();
    if (!server) {
      return reply(
        {
          error: 'beamd_not_connected',
          message: 'Connect Beamd on this machine before enabling auto-reconnect.',
        },
        { status: 400 },
      );
    }
    const port = portFromRequestUrl(request.url);
    setRunningPort(port);
    await openAndSaveBeamdBaseUrl(port);
    // The tunnel is now the externally-reachable URL the connector OAuth
    // redirect derives from — rebuild the runtime so it picks it up.
    invalidateConnectorRuntime();
    setAutoTunnel(true);
    return reply(snapshot());
  } catch (err) {
    // Leave the flag off on failure so state stays truthful.
    setAutoTunnel(false);
    if (err instanceof BeamdCliError) {
      return reply({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/settings/base-url/auto-tunnel]', err);
    return reply(
      {
        error: 'auto_tunnel_failed',
        message: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export const POSTInput = rpcZ.object({ body: legacySchema(bodySchema) }).strict();
