import { listInstalledApps } from '@/lib/fs/installed-apps';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * GET /api/fs/installed-apps
 *
 * Returns the subset of known editor/terminal apps that are installed
 * on this machine, plus an inline data-URL icon for each (macOS only —
 * we extract the actual `.icns` from the bundle so the menu shows the
 * real app icon). Lucide fallbacks live in the client.
 *
 * Response is small (~10 entries × ~1-2 KB each) so we ship it as
 * application/json with inline base64. Browser caches via standard
 * `Cache-Control: max-age` — apps come and go infrequently enough that
 * a 5-minute TTL is more than fine.
 */

export type { InstalledAppEntry, InstalledAppsResponse } from '@/lib/fs/installed-apps';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const body = await listInstalledApps();
    return reply(body, {
      headers: {
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('[GET /api/fs/installed-apps]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
