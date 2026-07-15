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
 * Deliberately free of the `node-pty` import so route handlers and tests
 * can resolve ownership without pulling in the native module.
 */
import { getChatSessionWithExecution } from '@/lib/db/queries';

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
