/**
 * Recording an agent's setup on a computer, as the home does (docs/homes-
 * spec.md §4.1), for tests: its project folder there, whether the computer
 * found it, and where its linked folders are.
 */

export async function setUpAgentOn(
  workspaceId: string,
  computerId: string,
  folder: string,
  opts: { found?: boolean; links?: Record<string, string | null> } = {},
) {
  const q = await import('@/lib/db/queries');
  q.setAgentFolder(workspaceId, computerId, folder);
  const refs = q.listReferenceFoldersForWorkspace(workspaceId);
  const checks: Array<{ path: string; exists: boolean }> = [{ path: folder, exists: opts.found ?? true }];
  for (const [alias, place] of Object.entries(opts.links ?? {})) {
    const ref = refs.find((r) => r.alias === alias);
    if (!ref) throw new Error(`No linked folder "${alias}" for ${workspaceId}`);
    q.setFolderLink(computerId, ref.id, place);
    if (place) checks.push({ path: place, exists: true });
  }
  q.recordFolderChecks(computerId, checks);
  // As the app does after every change: that computer's worker, if connected, is told.
  (await import('@/lib/setups/folders')).announceFolders(computerId);
  return q.getAgentSetup(workspaceId, computerId)!;
}
