import type { NextRequest } from 'next/server';
import { getChatSession, getWorkspace } from '@/lib/db/queries';

/**
 * Lightweight PR list for the chat composer's `#` mention menu. We
 * surface just what the popup needs: number, title, headRefName, state.
 * The single-PR `GET /sessions/:id/pr` endpoint stays the authoritative
 * source for the action bar's open/merge buttons — this is a different
 * read (the *list*, not the *current*), and a different consumer (the
 * composer popup), so it lives at its own route.
 *
 * Returns `{ prs: [] }` (never an error) when gh is missing, not
 * authenticated, the workspace is non-git, or the session has no
 * worktree yet — the popup's empty state already reads cleanly and the
 * composer shouldn't be noisy about missing infra.
 */

export interface PrListItem {
  number: number;
  title: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  url: string;
  updatedAt: string;
}

export interface PrListResponse {
  prs: PrListItem[];
  ghStatus?: 'not_installed' | 'not_authenticated';
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSession(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.workspace_id) return Response.json({ prs: [] } satisfies PrListResponse);

    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json({ prs: [] } satisfies PrListResponse);
    if (ws.is_git !== true) return Response.json({ prs: [] } satisfies PrListResponse);

    // ESM-only — same dynamic import pattern the single-PR route uses.
    const { github, NotInstalledError, NotAuthenticatedError } = await import('@agentex/github');
    const repo = github.repo(ws.cwd);

    try {
      // 'all' so closed/merged PRs still show up — sometimes the user
      // wants to reference a recently-merged PR for context. The popup
      // displays state inline so it's obvious which are still open.
      const all = await repo.listPRs({ state: 'all' });
      const prs: PrListItem[] = all
        .map((p) => ({
          number: p.number,
          title: p.title,
          state: p.state,
          isDraft: p.isDraft,
          headRefName: p.headRefName,
          baseRefName: p.baseRefName,
          url: p.url,
          updatedAt: p.updatedAt,
        }))
        // Newest activity first — matches Conductor's ordering and is
        // what the user almost always wants when picking a PR to
        // reference mid-conversation.
        .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
      return Response.json({ prs } satisfies PrListResponse);
    } catch (err) {
      if (err instanceof NotInstalledError) {
        return Response.json({
          prs: [],
          ghStatus: 'not_installed',
        } satisfies PrListResponse);
      }
      if (err instanceof NotAuthenticatedError) {
        return Response.json({
          prs: [],
          ghStatus: 'not_authenticated',
        } satisfies PrListResponse);
      }
      throw err;
    }
  } catch (err) {
    console.error('[GET /api/sessions/:id/prs]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
