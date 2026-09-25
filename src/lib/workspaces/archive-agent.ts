/**
 * Archive an agent and stop what it runs (docs/homes-build.md, P0.4 gap 2):
 * the app route and the `archive_workspace` action do the same thing. Each
 * of its chats has its harness closed (on a connected computer, a stop its
 * worker acts on when it receives it), and its terminals are killed.
 * Nothing on disk is touched, and its sessions stay readable.
 */

import type { WorkspaceRecord } from '@/db/types';
import { archiveWorkspace, listChatSessions } from '@/lib/db/queries';
import { killAllForOwner } from '@/lib/terminal/pty-manager';
import { terminalOwnerId, workspaceTerminalOwnerId } from '@/lib/terminal/owner';
import { close as closeHarnessSession } from '@/lib/executor/adapter';

export async function archiveAgent(id: string): Promise<WorkspaceRecord | null> {
  const row = archiveWorkspace(id);
  if (!row) return null;
  // Reap every process tied to this workspace's sessions — archiving the
  // workspace orphans them otherwise (they outlive it until the server
  // restarts). Both are safe no-ops when nothing's live:
  //   - node-pty terminals, owned per execution (deduped — many chats
  //     share one execution, and killing an owner twice is wasted work),
  //     plus the agent's own terminals on its folder
  //   - the cached harness subprocess, one per chat (the agent's main
  //     chat included)
  const sessions = listChatSessions({ workspaceId: id });
  const owners = new Set(sessions.map(terminalOwnerId)).add(workspaceTerminalOwnerId(id));
  for (const ownerId of owners) killAllForOwner(ownerId);
  await Promise.all(sessions.map((s) => closeHarnessSession(s.id)));
  return row;
}
