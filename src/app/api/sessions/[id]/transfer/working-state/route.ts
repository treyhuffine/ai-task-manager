/**
 * What a move would take from the execution's worktree, read where it runs
 * (P4.2): the tracked changes that always go, the untracked files the person
 * can choose to include, and the local setup and secrets that stay behind.
 */

import type { NextRequest } from 'next/server';
import fs from 'node:fs';
import { getChatSessionWithExecution, getWorkspace, placementOf } from '@/lib/db/queries';
import { readOnOwner } from '@/lib/executor/owner-files';
import { workingState } from '@/lib/transfer/git-checkpoint';

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const remote = await readOnOwner(id, { kind: 'working_state' });
  if (remote) return remote;
  const session = getChatSessionWithExecution(id);
  const ws = session?.workspaceId ? getWorkspace(session.workspaceId) : null;
  if (!session?.executionId || !ws) return Response.json({ error: 'Session not found' }, { status: 404 });
  if (!ws.isGit) return Response.json(null);
  const worktree = placementOf(session.executionId)?.worktreePath ?? session.worktreePath;
  if (!worktree || !fs.existsSync(worktree)) return Response.json({ error: 'Worktree unavailable' }, { status: 404 });
  return Response.json(await workingState(worktree, ws.filesToCopy ?? []));
}
