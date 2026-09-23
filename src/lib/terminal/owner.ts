/**
 * Who owns an in-app terminal.
 *
 * A terminal is a shell rooted in the worktree, and the worktree belongs
 * to the **execution** — so the execution owns it and every chat under
 * that execution shares the same set. Tagging terminals with the chat
 * session instead meant that starting a new chat on an execution (which
 * is what switching provider does) hid every running shell behind a key
 * nobody would ever query again: the PTY stayed alive server-side,
 * unreachable, while the panel auto-spawned a replacement in the very
 * same directory.
 *
 * Sessions with no execution fall back to owning their own terminals,
 * mirroring the client's worktree cache scope in `use-execution.ts`.
 * Nothing renders a terminal for those today; the fallback just keeps the
 * key total.
 *
 * An agent's own terminals (the agent view's Terminal tab) are rooted in the
 * agent's folder and owned by the workspace, under a prefixed key so they
 * can never collide with an execution's.
 *
 * Deliberately free of the `node-pty` import so route handlers and tests
 * can resolve ownership without pulling in the native module.
 */
import * as fs from 'node:fs';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';

/** Who owns the shells a route addresses, or why the route can't say. */
export type TerminalOwner =
  | { ok: true; ownerId: string }
  | { ok: false; error: string; status: number };

/** Where a new shell should start, or why it can't start yet. */
export type TerminalCwd =
  | { ok: true; cwd: string; ownerId: string }
  | { ok: false; error: string; status: number };

export function terminalOwnerId(session: { id: string; executionId?: string | null }): string {
  return session.executionId ?? session.id;
}

/**
 * Resolve the owner from a chat-session id — the form the `/api/sessions/
 * :id/terminals/*` routes need, since they're addressed by session but
 * operate on execution-owned shells. Null when the session doesn't exist.
 */
export function terminalOwnerForSession(sessionId: string): string | null {
  const session = getChatSessionWithExecution(sessionId);
  return session ? terminalOwnerId(session) : null;
}

export function sessionTerminalOwner(sessionId: string): TerminalOwner {
  const ownerId = terminalOwnerForSession(sessionId);
  return ownerId ? { ok: true, ownerId } : { ok: false, error: 'Session not found', status: 404 };
}

/** The key an agent's own terminals live under. */
export function workspaceTerminalOwnerId(workspaceId: string): string {
  return `workspace:${workspaceId}`;
}

export function workspaceTerminalOwner(workspaceId: string): TerminalOwner {
  return getWorkspace(workspaceId)
    ? { ok: true, ownerId: workspaceTerminalOwnerId(workspaceId) }
    : { ok: false, error: 'Workspace not found', status: 404 };
}

/**
 * Where a new shell on the agent's own folder starts. For a git agent that
 * is the source checkout, which is the point: this is the user's terminal on
 * their folder, not an execution's workbench. An archived agent gets no new
 * shells (archiving reaps the ones it had).
 */
export function workspaceTerminalCwd(workspaceId: string): TerminalCwd {
  const ws = getWorkspace(workspaceId);
  if (!ws) return { ok: false, error: 'Workspace not found', status: 404 };
  if (ws.status === 'archived') return { ok: false, error: 'This agent is archived', status: 409 };
  if (!isExistingDir(ws.cwd)) {
    return { ok: false, error: `The agent's folder does not exist: ${ws.cwd}`, status: 409 };
  }
  return { ok: true, cwd: ws.cwd, ownerId: workspaceTerminalOwnerId(workspaceId) };
}

/** Does this path resolve to an existing directory on disk? */
export function isExistingDir(p: string | null | undefined): p is string {
  if (!p) return false;
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
