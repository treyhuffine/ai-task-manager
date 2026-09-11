/**
 * Workspace policy defaults. These live in code, not as schema column
 * defaults, so the policy has one home and changing it never touches the DB.
 * Client-safe: no imports, usable from both the query layer and components.
 */

/**
 * Gitignored files copied from the source checkout into each worktree so an
 * execution can boot (env files by default). The committed project config is
 * tracked, so git already puts it in the worktree.
 */
export const DEFAULT_FILES_TO_COPY = ['.env*'];
