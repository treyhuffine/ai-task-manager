import type { NextRequest } from 'next/server';
import { detectInstalledApps, type DetectedApp } from '@/lib/fs/detect-apps';
import { extractAppIconPng } from '@/lib/fs/extract-icon';
import { withCompression } from '@/lib/api/compression';

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

export interface InstalledAppEntry {
  target: DetectedApp['target'];
  label: string;
  /** `data:image/png;base64,…` when the platform supports icon
   *  extraction (macOS) and the bundle yielded an icon, otherwise null. */
  iconDataUrl: string | null;
}

export interface InstalledAppsResponse {
  platform: NodeJS.Platform;
  apps: InstalledAppEntry[];
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(_request: NextRequest) {
  try {
    const detected = await detectInstalledApps();
    const apps: InstalledAppEntry[] = await Promise.all(
      detected.map(async (app) => {
        let iconDataUrl: string | null = null;
        if (app.source && process.platform === 'darwin' && app.source.endsWith('.app')) {
          const png = await extractAppIconPng(app.source);
          if (png) iconDataUrl = `data:image/png;base64,${png.toString('base64')}`;
        }
        return { target: app.target, label: app.label, iconDataUrl };
      }),
    );

    const body: InstalledAppsResponse = { platform: process.platform, apps };
    return Response.json(body, {
      headers: {
        'Cache-Control': 'private, max-age=300',
      },
    });
  } catch (err) {
    console.error('[GET /api/fs/installed-apps]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
