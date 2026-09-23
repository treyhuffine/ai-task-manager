import type { NextRequest } from 'next/server';
import { workspaceTerminalCwd, workspaceTerminalOwner } from '@/lib/terminal/owner';
import { createTerminalResponse, listTerminalsResponse } from '@/lib/terminal/http';
import { withCompression } from '@/lib/api/compression';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The agent's own terminals, rooted in its folder (the source checkout for a
 * git agent). Owned by the workspace, separate from every execution's
 * shells. Same shapes as `/api/sessions/:id/terminals`.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return listTerminalsResponse(workspaceTerminalOwner(id));
  } catch (err) {
    console.error('[GET /api/workspaces/:id/terminals]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return await createTerminalResponse(request, workspaceTerminalCwd(id), '[POST /api/workspaces/:id/terminals]');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/workspaces/:id/terminals]', err);
    return Response.json({ error: message }, { status: 500 });
  }
}
