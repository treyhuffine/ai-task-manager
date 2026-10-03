import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
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
 *
 * A chat that runs on another device gets that device's paths, as the home
 * records them from its last check (docs/homes-spec.md §4.1), since that's
 * where its agent reads them. Their files are on that device, so they aren't
 * browsable from here: picking one mentions the folder.
 */
import { chatPlacement, getChatSession, getWorkspaceSetup, listReferenceFoldersForWorkspace } from '@/lib/db/queries';
import { listResolvedReferenceFolders } from '@/lib/reference-folders/resolve';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });

    const placement = chatPlacement(id);
    if (placement && !placement.isHome && session.workspaceId) {
      const reports = new Map((getWorkspaceSetup(session.workspaceId, placement.deviceId)?.references ?? []).map((r) => [r.alias, r]));
      return reply({
        referenceFolders: listReferenceFoldersForWorkspace(session.workspaceId).map((ref) => {
          const there = reports.get(ref.alias);
          return {
            id: ref.id,
            alias: ref.alias,
            absolutePath: there?.path ?? '',
            exists: Boolean(there?.path && there.exists),
            browsable: false,
          };
        }),
      });
    }

    const rows = await listResolvedReferenceFolders(session.workspaceId, { probeGit: false });
    return reply({
      referenceFolders: rows.map((r) => ({
        id: r.id,
        alias: r.alias,
        absolutePath: r.absolutePath,
        exists: r.exists,
        browsable: true,
      })),
    });
  } catch (err) {
    console.error('[GET /api/sessions/:id/reference-folders]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
