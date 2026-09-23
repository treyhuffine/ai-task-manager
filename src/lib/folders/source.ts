/**
 * The folder a file tree, file viewer or terminal is pointed at
 * (docs/agents-view-spec.md Phase 7): an execution's worktree, addressed
 * through one of its chat sessions, or an agent's own folder, addressed
 * through its workspace. Both expose the same routes under different
 * prefixes (`/api/sessions/:id/...` and `/api/workspaces/:id/...`), with
 * the same response shapes, so components take a source rather than a
 * session id.
 */
export type FolderSource =
  | { kind: 'session'; sessionId: string }
  | { kind: 'workspace'; workspaceId: string };

export const sessionFolder = (sessionId: string): FolderSource => ({ kind: 'session', sessionId });

export const workspaceFolder = (workspaceId: string): FolderSource => ({ kind: 'workspace', workspaceId });

/** Route prefix under `/api` for the source's folder routes. */
export function folderApiBase(source: FolderSource): string {
  return source.kind === 'session' ? `/sessions/${source.sessionId}` : `/workspaces/${source.workspaceId}`;
}

/**
 * Whether files can be created, edited, renamed or deleted from the app.
 * An agent's own folder is read-only here: a git agent's checkout changes
 * through executions, and editing from the agent view is out of scope.
 */
export function folderIsWritable(source: FolderSource): boolean {
  return source.kind === 'session';
}

/** Stable id for per-folder client state (expanded dirs, view mode). */
export function folderStateId(source: FolderSource, executionId?: string | null): string {
  return source.kind === 'session' ? (executionId ?? source.sessionId) : `workspace-${source.workspaceId}`;
}
