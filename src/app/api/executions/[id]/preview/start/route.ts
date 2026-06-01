/**
 * Bring a preview up. The viewer decides reachability and passes `remote`:
 *   - `remote: false` (default) → ensure the worktree's dev server is up,
 *     return the loopback `localUrl` (viewer is on the same machine).
 *   - `remote: true` → route through the active remote provider (beamd, …):
 *     cold-start the server if needed, then resolve a reachable URL.
 *
 * Lazy cold-start lives here — a Flow/host restart is a non-event because
 * the first start spins both the server and (for remote) the tunnel back up.
 */

import type { NextRequest } from 'next/server';
import { resolvePreview } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';

export const runtime = 'nodejs';

interface StartBody {
  service?: string | null;
  remote?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as StartBody;
    const state = await resolvePreview(id, {
      service: body.service ?? null,
      remote: body.remote ?? false,
    });
    return Response.json(state);
  } catch (err) {
    return previewErrorResponse(err, 'POST /api/executions/:id/preview/start');
  }
}
