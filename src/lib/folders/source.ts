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
  /** `readOnly` for an archived agent, whose routes refuse writes (409). */
  | { kind: 'workspace'; workspaceId: string; readOnly?: boolean };

export const sessionFolder = (sessionId: string): FolderSource => ({ kind: 'session', sessionId });

export const workspaceFolder = (workspaceId: string, opts: { readOnly?: boolean } = {}): FolderSource => ({
  kind: 'workspace',
  workspaceId,
  ...(opts.readOnly ? { readOnly: true } : {}),
});

/** Route prefix under `/api` for the source's folder routes. */
export function folderApiBase(source: FolderSource): string {
  return source.kind === 'session' ? `/sessions/${source.sessionId}` : `/workspaces/${source.workspaceId}`;
}

/**
 * Whether files can be created, edited, renamed or deleted from the app.
 * Both an execution's worktree and an agent's own folder can, except an
 * archived agent's. Edits here are the person's: the agent's main chat
 * still never writes to its folder (docs/agents-view-spec.md Phase 6).
 */
export function folderIsWritable(source: FolderSource): boolean {
  return source.kind === 'session' || !source.readOnly;
}

/** Stable id for per-folder client state (expanded dirs, view mode). */
export function folderStateId(source: FolderSource, executionId?: string | null): string {
  return source.kind === 'session' ? (executionId ?? source.sessionId) : `workspace-${source.workspaceId}`;
}
