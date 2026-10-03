import type { ChatSessionWithExecution } from '@/lib/api/dto/records';


/**
 * The folder an execution works in, wherever it runs (P3.1): its worktree at
 * home, or the folder its device prepared. Null while it's still being set
 * up. `worktreePath` alone is only ever a folder on the home, so an execution
 * on a laptop read as setting up forever.
 */
export function preparedFolder(session: Pick<ChatSessionWithExecution, 'worktreePath' | 'location'>): string | null {
  if (session.worktreePath) return session.worktreePath;
  return session.location && !session.location.isHome ? session.location.folder : null;
}

/**
 * The device to show on an execution, or null to show none. The standard
 * case goes unsaid: work on the home is unlabeled, and only work away from it
 * names its device (`away`, the default). `always` names the home too, once
 * there are other devices to tell it apart from. See
 * `lib/client/device-label-mode.ts`.
 */
export function locationLabel(
  session: Pick<ChatSessionWithExecution, 'location'>,
  severalDevices: boolean,
  mode: 'away' | 'always' = 'away',
): string | null {
  const location = session.location;
  if (!location) return null;
  if (!location.isHome) return location.name;
  return mode === 'always' && severalDevices ? location.name : null;
}

/** How a device starts running Ri, until the companion app does it at login (P5.4). */
export const START_RI = 'ri worker run';
