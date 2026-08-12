/**
 * Feeds the composer's `@`-picker with this session's reference folders
 * (docs/reference-folders-spec.md §8) — the read-only folders outside the
 * worktree that the agent has already been told about.
 *
 * Session-scoped rather than workspace-scoped for the same reason as the
 * sibling `picker` route: the composer knows its session id and nothing else,
 * and resolving the workspace here keeps that plumbing off the client.
 *
 * Returns exactly what the picker needs (id, alias, path, existence). No git
 * probe — the picker doesn't render drift, and probing every reference on
 * composer mount would spawn subprocesses nobody asked for.
 */
import type { NextRequest } from 'next/server';
import { getChatSession } from '@/lib/db/queries';
import { listResolvedReferenceFolders } from '@/lib/reference-folders/resolve';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });

    const rows = await listResolvedReferenceFolders(session.workspaceId, { probeGit: false });
    return Response.json({
      referenceFolders: rows.map((r) => ({
        id: r.id,
        alias: r.alias,
        absolutePath: r.absolutePath,
        exists: r.exists,
      })),
    });
  } catch (err) {
    console.error('[GET /api/sessions/:id/reference-folders]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
