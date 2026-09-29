import type { NextRequest } from 'next/server';
import { mapFileError } from '@/lib/workspaces/file-http';
import { agentFolderWrite } from '../../_folder';

/**
 * Move or rename a file or directory in the agent's folder, refusing to
 * overwrite an existing target (409). Mirrors
 * `/api/sessions/:id/file/rename`. POST body: `{ from: string, to: string }`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => null)) as { from?: unknown; to?: unknown } | null;
    if (!body || typeof body.from !== 'string' || typeof body.to !== 'string') {
      return Response.json({ error: 'Body must be { from: string, to: string }' }, { status: 400 });
    }
    return await agentFolderWrite(id, { kind: 'rename', from: body.from, to: body.to });
  } catch (err) {
    return mapFileError(err, '[POST /api/workspaces/:id/file/rename]');
  }
}
