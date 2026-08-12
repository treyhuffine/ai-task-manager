import type { NextRequest } from 'next/server';
import { getReferenceFolder } from '@/lib/db/queries';
import { resolveReferenceFolder } from '@/lib/reference-folders/resolve';
import { listReferenceTree } from '@/lib/reference-folders/tree';
import { withCompression } from '@/lib/api/compression';

/**
 * Flat file list for one reference folder, backing the `@alias` drill-down in
 * the composer (docs/reference-folders-spec.md §8).
 *
 * Read-only by construction: `listReferenceTree` shells out to `git ls-files`
 * or walks the directory, and never opens an agentex workspace handle (which
 * would need worktree metadata a reference folder does not have).
 *
 * No git probe here — the picker only needs paths, and probing would add a
 * subprocess to every drill-down.
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
    const row = getReferenceFolder(id);
    if (!row) return Response.json({ error: 'Reference folder not found' }, { status: 404 });

    const resolved = await resolveReferenceFolder(row, { probeGit: false });
    if (!resolved) {
      return Response.json(
        { error: 'Reference folder has no resolvable target' },
        { status: 404 },
      );
    }
    if (!resolved.exists) {
      // Broken references stay listed in settings so the user can fix them,
      // but there is nothing to browse. Empty rather than an error so the
      // picker renders "no matches" instead of blowing up mid-keystroke.
      return Response.json({ entries: [], truncated: false });
    }

    const { entries, truncated } = await listReferenceTree(resolved.absolutePath);
    return Response.json({ entries, truncated });
  } catch (err) {
    console.error('[GET /api/reference-folders/:id/tree]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
