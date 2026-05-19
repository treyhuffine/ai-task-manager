/**
 * Host-level Portless detection.
 *
 * Used by the workspace settings UI to:
 *   - Show "Detected on this host" next to the Portless mode option.
 *   - Suggest installing or switching to Portless when relevant.
 *
 * Cached inside the portless module — calling this every settings-open
 * is cheap.
 */

import type { NextRequest } from 'next/server';
import { detectPortless } from '@/lib/preview/portless';

export async function GET(_request: NextRequest) {
  try {
    const status = detectPortless();
    return Response.json({
      installed: status.installed,
      proxy_running: status.proxyRunning,
      state_dir: status.stateDir,
    });
  } catch (err) {
    console.error('[GET /api/system/portless-status]', err);
    return Response.json({ error: 'portless_status_failed', message: String(err) }, { status: 500 });
  }
}
