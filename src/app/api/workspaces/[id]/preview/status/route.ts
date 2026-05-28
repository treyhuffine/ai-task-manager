/**
 * Unified status envelope for a workspace's preview.
 *
 * The client uses this for the pane's initial state load and short-poll
 * refresh. The `mode` field is the *effective* mode (auto-detect resolves
 * to either 'command' or 'portless') so the UI doesn't need to consult
 * Portless separately.
 *
 *   - command mode: status, port, previewToken come from the supervisor.
 *   - portless mode: status + port + hostname + tailscale URLs come from
 *     `~/.portless/routes.json`. No previewToken — Portless mode iframes
 *     authenticate via the standard Flow session cookie.
 */

import type { NextRequest } from 'next/server';
import { getWorkspace, resolveWorkspacePreviewMode } from '@/lib/db/queries';
import { getSupervisor } from '@/lib/preview/supervisor';
import { derivePortlessHostname, findRoute } from '@/lib/preview/portless';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ws = getWorkspace(id);
    if (!ws) return Response.json({ error: 'workspace_not_found' }, { status: 404 });

    const mode = resolveWorkspacePreviewMode(ws);

    if (mode === 'portless') {
      const hostname = ws.portlessHostname?.trim() || derivePortlessHostname({ slug: ws.slug });
      const route = findRoute(hostname);
      if (!route) {
        return Response.json({
          mode: 'portless' as const,
          status: 'idle' as const,
          port: null,
          previewToken: null,
          hostname,
          tailscaleUrl: null,
          tailscaleFunnelUrl: null,
          message: `No Portless app registered as ${hostname}.localhost. Run \`portless run\` in the workspace.`,
        });
      }
      return Response.json({
        mode: 'portless' as const,
        status: 'running' as const,
        port: route.port,
        previewToken: null,
        hostname,
        tailscaleUrl: route.tailscaleUrl ?? null,
        tailscaleFunnelUrl: route.tailscaleFunnel ? (route.tailscaleUrl ?? null) : null,
      });
    }

    // command mode
    const rec = getSupervisor().status(id);
    if (!rec) {
      return Response.json({
        mode: 'command' as const,
        status: 'idle' as const,
        port: null,
        previewToken: null,
        startedAt: null,
        exitedAt: null,
        exitCode: null,
      });
    }

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
    console.error('[GET /api/workspaces/:id/preview/status]', err);
    return Response.json({ error: 'preview_status_failed', message: String(err) }, { status: 500 });
  }
}
