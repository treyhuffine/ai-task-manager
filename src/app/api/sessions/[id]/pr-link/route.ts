import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';
import { linkedPullUrl } from '@/lib/github/remote';
import type { PrLinkResponse } from '@/lib/api/sessions';

/**
 * The linked PR's address, worked out without asking GitHub: the session's
 * PR number plus the repo's `origin` remote. `GET /sessions/:id/pr` stays the
 * authority on the PR's state. This only keeps the PR one click away when
 * that lookup can't answer (gh missing or signed out, GitHub unreachable, no
 * worktree, an archived execution), so it never calls gh.
 *
 * `{ linked: null }` when no PR is linked or `origin` isn't on GitHub.
 */

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const session = getChatSessionWithExecution(id);
  if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
  // The workspace's own checkout, not the worktree: it outlives an archived
  // execution's worktree and exists before setup finishes.
  const ws = session.workspaceId ? getWorkspace(session.workspaceId) : undefined;
  const prNumber = session.prNumber;
  if (prNumber == null || !ws) return Response.json({ linked: null } satisfies PrLinkResponse);
  const url = await linkedPullUrl(ws.cwd, prNumber);
  return Response.json({ linked: url ? { number: prNumber, url } : null } satisfies PrLinkResponse);
}
