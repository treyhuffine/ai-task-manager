/**
 * Rotate the preview token. Used by the client when the per-workspace
 * preview cookie expires and the iframe needs to re-init.
 *
 * 404 if there's no running supervisor record — there's no token to
 * rotate unless a process is associated with this workspace.
 */

import type { NextRequest } from 'next/server';
import { getSupervisor } from '@/lib/preview/supervisor';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const token = getSupervisor().rotateToken(id);
    if (!token) {
      return Response.json(
        { error: 'preview_not_running', message: 'No preview process to refresh a token for.' },
        { status: 404 },
      );
    }
    return Response.json({ preview_token: token });
  } catch (err) {
    console.error('[POST /api/workspaces/:id/preview/refresh-token]', err);
    return Response.json(
      { error: 'preview_refresh_token_failed', message: String(err) },
      { status: 500 },
    );
  }
}
