import type { ChatSessionWithExecution } from '@/db/types';

/**
 * The folder an execution works in, wherever it runs (P3.1): its worktree at
 * home, or the folder its computer prepared. Null while it's still being set
 * up. `worktreePath` alone is only ever a folder on the home, so an execution
 * on a laptop read as setting up forever.
 */
export function preparedFolder(session: Pick<ChatSessionWithExecution, 'worktreePath' | 'location'>): string | null {
  if (session.worktreePath) return session.worktreePath;
  return session.location && !session.location.isHome ? session.location.folder : null;
}

/**
 * The computer to show on an execution, or null to show none: always when it
 * runs away from the home, and at home only when the home has other computers
 * to tell it apart from.
 */
export function locationLabel(
  session: Pick<ChatSessionWithExecution, 'location'>,
  severalComputers: boolean,
): string | null {
  const location = session.location;
  if (!location) return null;
  return !location.isHome || severalComputers ? location.name : null;
}
