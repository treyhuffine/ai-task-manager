/**
 * Stop the preview process for a workspace.
 *
 * Command mode only. In Portless mode (P5) this returns 400 since
 * Portless owns process lifecycle.
 */

import type { NextRequest } from 'next/server';
import { getWorkspace, resolveWorkspacePreviewMode } from '@/lib/db/queries';
import { getSupervisor } from '@/lib/preview/supervisor';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'workspace_not_found' }, { status: 404 });

    const mode = resolveWorkspacePreviewMode(ws);
    if (mode === 'portless') {
      return Response.json(
        {
          error: 'preview_mode_not_command',
          message: 'Portless owns process lifecycle. Stop the dev server in your terminal.',
        },
        { status: 400 },
      );
    }

    await getSupervisor().stop(id);
    return Response.json({ ok: true as const });
  } catch (err) {
    console.error('[POST /api/workspaces/:id/preview/stop]', err);
    return Response.json({ error: 'preview_stop_failed', message: String(err) }, { status: 500 });
  }
}
