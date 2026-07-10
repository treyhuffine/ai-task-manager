import { listChatSessions, listWorkspaces } from '@/lib/db/queries';
import { removeOwnedProjectSkillLinks } from './shipped';

export interface ProjectSkillCleanupResult {
  scanned: number;
  removed: number;
  errors: number;
}

/** Clean legacy shipped-skill links from every registered workspace/worktree. */
export async function cleanupKnownProjectSkillLinks(): Promise<ProjectSkillCleanupResult> {
  const dirs = new Set<string>();
  try {
    for (const status of ['active', 'archived'] as const) {
      for (const workspace of listWorkspaces({ status })) {
        if (workspace.cwd) dirs.add(workspace.cwd);
      }
    }
    for (const session of listChatSessions({ type: 'execution' })) {
      if (session.worktreePath) dirs.add(session.worktreePath);
    }
  } catch {
    return { scanned: 0, removed: 0, errors: 1 };
  }

  let removed = 0;
  let errors = 0;
  for (const cwd of dirs) {
    try {
      const result = await removeOwnedProjectSkillLinks(cwd);
      removed += result.removed;
      errors += result.entries.filter((entry) => entry.status === 'error').length;
    } catch {
      errors += 1;
    }
  }
  return { scanned: dirs.size, removed, errors };
}
