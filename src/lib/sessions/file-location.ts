import type { ChatSessionWithExecution } from '@/db/types';
import { getWorkspace } from '@/lib/db/queries';
import { preparedFolder } from '@/lib/executions/location';
import { runOnFor } from '@/lib/setups/run-on';
import type { ReplyFileChat } from './reply-files';

/** Executions use their worktree. An agent's main chat uses that agent's own folder and device. */
export function sessionFileLocation(session: ChatSessionWithExecution): ReplyFileChat {
  if (session.executionId) return {
    folder: preparedFolder(session),
    elsewhere: session.location && !session.location.isHome ? session.location.name : null,
  };
  const workspace = session.workspaceId ? getWorkspace(session.workspaceId) : null;
  const livesOn = workspace ? runOnFor(workspace.id)?.livesOn : null;
  return {
    folder: livesOn?.folder ?? workspace?.cwd ?? null,
    elsewhere: livesOn && !livesOn.isHome ? livesOn.name : null,
  };
}
