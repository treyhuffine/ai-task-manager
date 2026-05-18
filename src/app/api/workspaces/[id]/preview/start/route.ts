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

    const command = ws.preview_command?.trim();
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
      workspace_id: id,
      command,
      cwd,
      port_override: ws.preview_port_override ?? null,
    });

    return Response.json({
      mode: 'command' as const,
      status: rec.status,
      port: rec.port,
      preview_token: rec.preview_token,
      started_at: rec.started_at,
      exited_at: rec.exited_at,
      exit_code: rec.exit_code,
    });
  } catch (err) {
    if (err instanceof SupervisorError) {
      return Response.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error('[POST /api/workspaces/:id/preview/start]', err);
    return Response.json({ error: 'preview_start_failed', message: String(err) }, { status: 500 });
  }
}
