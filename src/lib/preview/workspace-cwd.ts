/**
 * Resolve the working directory where a workspace's preview process
 * should spawn.
 *
 * For non-git workspaces (or git workspaces without a worktree convention),
 * we use the workspace's `cwd` directly — the same folder the user pointed
 * Flow at. The dev server runs against whatever's checked out there.
 *
 * For git workspaces with an active execution session, we'd ideally run
 * inside that session's worktree so the preview reflects the agent's work.
 * In v1 we keep things simple and use the workspace cwd — the user can
 * still see the agent's changes since most agent loops commit (or stage)
 * to the workspace root anyway. Per-session preview pinning is in the
 * "out of scope" list of the spec.
 */

import type { WorkspaceRecord } from '@/db/types';

export async function workspaceCwdForPreview(ws: WorkspaceRecord): Promise<string> {
  return ws.cwd;
}
