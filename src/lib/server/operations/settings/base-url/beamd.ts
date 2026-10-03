import { baseUrlSnapshot as snapshot } from '@/lib/auth/base-url-snapshot';
import { openAndSaveBeamdBaseUrl } from '@/lib/auth/beamd-base-url';
import { setRunningPort } from '@/lib/auth/bootstrap';
import { portFromRequestUrl } from '@/lib/auth/port';
import { invalidateConnectorRuntime } from '@/lib/connectors/runtime';
import { BeamdCliError } from '@/lib/preview/beamd/cli';
import { readLiveServerRuntime } from '@/lib/server-runtime/record';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const running = readLiveServerRuntime();
    const port = running?.privateUpstreams?.next ? Number(new URL(running.privateUpstreams.next).port) : portFromRequestUrl(request.url);
    setRunningPort(port);
    const beamd = await openAndSaveBeamdBaseUrl(port);
    // Opening the tunnel changes the externally-reachable URL the connector
    // OAuth redirect derives from — rebuild the runtime so it picks it up.
    invalidateConnectorRuntime();
    return reply({ ...snapshot(), beamd });
  } catch (err) {
    if (err instanceof BeamdCliError) {
      return reply({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/settings/base-url/beamd]', err);
    return reply(
      { error: 'beamd_base_url_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({}).strict().default({}) }).strict();
