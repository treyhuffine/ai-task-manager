import { getReferenceFolder } from '@/lib/db/queries';
import { resolveReferenceFolder } from '@/lib/reference-folders/resolve';
import { listReferenceTree } from '@/lib/reference-folders/tree';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

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

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = getReferenceFolder(id);
    if (!row) return reply({ error: 'Reference folder not found' }, { status: 404 });

    const resolved = await resolveReferenceFolder(row, { probeGit: false });
    if (!resolved) {
      return reply(
        { error: 'Reference folder has no resolvable target' },
        { status: 404 },
      );
    }
    if (!resolved.exists) {
      // Broken references stay listed in settings so the user can fix them,
      // but there is nothing to browse. Empty rather than an error so the
      // picker renders "no matches" instead of blowing up mid-keystroke.
      return reply({ entries: [], truncated: false });
    }

    const { entries, truncated } = await listReferenceTree(resolved.absolutePath);
    return reply({ entries, truncated });
  } catch (err) {
    console.error('[GET /api/reference-folders/:id/tree]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
