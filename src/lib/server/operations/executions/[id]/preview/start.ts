import { failureResponse, reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Bring a preview up. The viewer decides reachability and passes `remote`:
 *   - `remote: false` (default) → ensure the worktree's dev server is up,
 *     return the loopback `localUrl` (viewer is on the same machine).
 *   - `remote: true` → route through the active remote provider (beamd, …):
 *     cold-start the server if needed, then resolve a reachable URL.
 *
 * Lazy cold-start lives here — a Ri/host restart is a non-event because
 * the first start spins both the server and (for remote) the tunnel back up.
 */

import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { resolvePreview } from '@/lib/preview/service';

interface StartBody {
  service?: string | null;
  remote?: boolean;
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body = (rpcInput.body) as StartBody;
    const state = await resolvePreview(id, {
      service: body.service ?? null,
      remote: body.remote ?? false,
    });
    return reply(state);
  } catch (err) {
    return failureResponse(previewErrorResponse(err, 'POST /api/executions/:id/preview/start'));
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "service": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "remote": rpcZ.boolean().optional() }).strict().default({}) }).strict();
