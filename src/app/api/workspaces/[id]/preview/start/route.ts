/**
 * Start the preview process for a workspace.
 *
 * Command mode only. Phase 5 will branch on Portless mode and 400 here
 * for `preview_mode_not_command` instead of spawning.
 */

import type { NextRequest } from 'next/server';
import { getWorkspace, resolveWorkspacePreviewMode } from '@/lib/db/queries';
import { getSupervisor, SupervisorError } from '@/lib/preview/supervisor';
import { workspaceCwdForPreview } from '@/lib/preview/workspace-cwd';

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
          message: 'This workspace is in Portless mode. Run `portless run` in the worktree to start the preview.',
        },
        { status: 400 },
      );
    }

    const command = ws.previewCommand?.trim();
    if (!command) {
      return Response.json(
        {
          error: 'preview_no_command',
          message: 'Set a preview command in workspace settings before starting the preview.',
        },
        { status: 400 },
      );
    }

    const cwd = await workspaceCwdForPreview(ws);
    const rec = await getSupervisor().start({
      workspaceId: id,
      command,
      cwd,
      portOverride: ws.previewPortOverride ?? null,
    });

    return Response.json({
      mode: 'command' as const,
      status: rec.status,
      port: rec.port,
      previewToken: rec.previewToken,
      startedAt: rec.startedAt,
      exitedAt: rec.exitedAt,
      exitCode: rec.exitCode,
    });
  } catch (err) {
    if (err instanceof SupervisorError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/workspaces/:id/preview/start]', err);
    return Response.json({ error: 'preview_start_failed', message: String(err) }, { status: 500 });
  }
}
