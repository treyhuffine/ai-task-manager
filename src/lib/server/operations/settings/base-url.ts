import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Pair base URLs.
 *
 *   GET     → BaseUrlSnapshot          // server-side-known base URLs
 *   PATCH   { baseUrl } → same shape   // set/clear the tunnel URL
 *   DELETE  → clears tunnel URL
 *
 * `tunnel` is user-configured and persisted to ~/<APP_SHORT_ID>/config.json.
 * `lan` is auto-detected from the first non-loopback IPv4 interface.
 * `local` is `http://localhost:<running port>`.
 */

import { baseUrlSnapshot as snapshot } from '@/lib/auth/base-url-snapshot';
import { clearRemoteBaseUrl, setRemoteBaseUrl } from '@/lib/auth/bootstrap';
import { invalidateConnectorRuntime } from '@/lib/connectors/runtime';

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  return reply(snapshot());
}

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  try {
    const body = (rpcInput.body) as { baseUrl?: string | null };
    if (body.baseUrl === null || body.baseUrl === '') {
      clearRemoteBaseUrl();
    } else if (typeof body.baseUrl === 'string') {
      setRemoteBaseUrl(body.baseUrl);
    } else {
      return reply({ error: 'baseUrl must be a string or null' }, { status: 400 });
    }
    // The connector OAuth redirect derives from this URL and is baked into the
    // cached runtime's auth configs — rebuild so it reflects the new value.
    invalidateConnectorRuntime();
    return reply(snapshot());
  } catch (err) {
    return reply(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}

export async function DELETE(_rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  clearRemoteBaseUrl();
  invalidateConnectorRuntime();
  return reply(snapshot());
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PATCHInput = rpcZ.object({ body: rpcZ.object({ "baseUrl": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional() }).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ body: rpcZ.object({}).strict().default({}) }).strict();
