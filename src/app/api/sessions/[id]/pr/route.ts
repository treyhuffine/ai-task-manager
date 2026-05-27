import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getWorkspace, insertChatEvent } from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import { buildOpenPrPrompt } from '@/lib/executor/prompts/open-pr';
import * as executor from '@/lib/executor/adapter';
import { getPrMergeable, type PrMergeable } from '@/lib/github/pr-mergeable';

/**
 * PR surface for the execution view's action bar.
 *
 *   GET  — look up the PR for the session's branch via `@agentex/github`.
 *          Returns `null` when none exists.
 *   POST — inject a "draft a title/body and `gh pr create` …" prompt into
 *          the chat session. The agent's existing Bash tool runs the
 *          actual `gh pr create`. The prompt always includes a compact
 *          diff summary so the agent can write a meaningful title even
 *          when the user clicks Open PR without a prior turn.
 */

export interface PrInfo {
  number: number;
  url: string;
  state: 'OPEN' | 'CLOSED' | 'MERGED';
  isDraft: boolean;
  headRefName: string;
  baseRefName: string;
  title: string;
  updatedAt: string;
  /**
   * GitHub-reported mergeability. `'UNKNOWN'` either means GitHub hasn't
   * computed it yet (typically right after a push) or our gh side-call
   * failed — the action bar treats unknown as in-sync, not as a blocker.
   * Only populated for OPEN PRs; closed/merged PRs carry `null`.
   */
  mergeable: PrMergeable | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (!session.workspace_id || !session.worktree_path || !session.branch_name) {
      return Response.json({ pr: null });
    }

    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json({ pr: null });

    // `@agentex/github` is ESM-only; dynamic import for the same reason
    // `@agentex/workspace` is loaded lazily in `lib/workspaces/index.ts`.
    const { github, NotInstalledError, NotAuthenticatedError } = await import('@agentex/github');
    const repo = github.repo(ws.cwd);

    try {
      // 1. Explicit `pr_number` on the session row wins — used when the
      //    user linked a PR manually or when the agent stamped it on
      //    PR creation.
      if (session.pr_number != null) {
        try {
          const pr = await repo.getPR(session.pr_number);
          const mergeable = pr.state === 'OPEN' ? await getPrMergeable(ws.cwd, pr.number) : null;
          const info: PrInfo = {
            number: pr.number,
            url: pr.url,
            state: pr.state,
            isDraft: pr.isDraft,
            headRefName: pr.headRefName,
            baseRefName: pr.baseRefName,
            title: pr.title,
            updatedAt: pr.updatedAt,
            mergeable,
          };
          return Response.json({ pr: info });
        } catch (err) {
          console.warn(
            `[GET /api/sessions/${id}/pr] linked pr_number=${session.pr_number} lookup failed:`,
            err instanceof Error ? err.message : String(err),
          );
          // Fall through to branch-match below — the linked PR might
          // have been deleted on GitHub.
        }
      }

      // 2. Branch-match fallback — pull all PRs and filter on headRefName.
      const all = await repo.listPRs({ state: 'all' });
      // Exact match first; fall back to suffix match for fork-style
      // refs ("user:branch" / "user/branch") where gh sometimes reports
      // a qualified head name.
      let matching = all.filter((p) => p.headRefName === session.branch_name);
      if (matching.length === 0) {
        matching = all.filter((p) =>
          session.branch_name ? p.headRefName.endsWith(session.branch_name) : false,
        );
      }
      // Prefer open; otherwise the most recent.
      const pr = matching.find((p) => p.state === 'OPEN') ?? matching[0];
      if (!pr) {
        // Surface the diagnostic so we can see why we missed. Only
        // fires when gh actually returned PRs — empty repos stay quiet.
        if (all.length > 0) {
          console.warn(
            `[GET /api/sessions/${id}/pr] no PR matched session branch "${session.branch_name}". gh sees ${all.length} PR(s): ${all
              .slice(0, 6)
              .map((p) => `#${p.number}=${p.headRefName}`)
              .join(', ')}${all.length > 6 ? ', …' : ''}`,
          );
        }
        return Response.json({ pr: null });
      }
      const mergeable = pr.state === 'OPEN' ? await getPrMergeable(ws.cwd, pr.number) : null;
      const info: PrInfo = {
        number: pr.number,
        url: pr.url,
        state: pr.state,
        isDraft: pr.isDraft,
        headRefName: pr.headRefName,
        baseRefName: pr.baseRefName,
        title: pr.title,
        updatedAt: pr.updatedAt,
        mergeable,
      };
      return Response.json({ pr: info });
    } catch (err) {
      if (err instanceof NotInstalledError) {
        return Response.json({ pr: null, ghStatus: 'not_installed' });
      }
      if (err instanceof NotAuthenticatedError) {
        return Response.json({ pr: null, ghStatus: 'not_authenticated' });
      }
      throw err;
    }
  } catch (err) {
    console.error('[GET /api/sessions/:id/pr]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) return Response.json({ error: 'Session not found' }, { status: 404 });
    if (session.status === 'archived') {
      return Response.json({ error: 'Cannot open a PR on an archived session' }, { status: 400 });
    }
    if (executor.isRunning(id)) {
      return Response.json(
        { error: 'already_running', message: 'A turn is already in flight for this session.' },
        { status: 409 },
      );
    }
    if (!session.workspace_id || !session.worktree_path || !session.branch_name) {
      return Response.json(
        { error: 'no_worktree', message: 'No worktree or branch on this session.' },
        { status: 400 },
      );
    }

    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.base_branch) {
      return Response.json(
        { error: 'no_base_branch', message: 'Workspace has no base branch configured.' },
        { status: 400 },
      );
    }

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'Worktree unavailable' }, { status: 404 });
    }

    const diff = await handle.git.diff('base');
    const prompt = buildOpenPrPrompt({
      branch: session.branch_name,
      baseBranch: ws.base_branch,
      diff,
    });

    // Persist the prompt as a user-role event so the transcript shows
    // exactly what the agent was asked to do — same pattern as a real
    // user-typed message. Mark `source: 'system'` so the transcript can
    // render it as an action-bar event rather than an organic user
    // message (the executor still dispatches it as the next turn).
    insertChatEvent({
      session_id: id,
      role: 'user',
      source: 'user',
      content: prompt,
      created_at: new Date().toISOString(),
    });

    // Fire-and-forget dispatch into the executor. The agent's reply
    // (drafted title/body and `gh pr create` invocation) streams back
    // through the existing chat-event pipeline.
    executor.dispatch(id, prompt).catch((err) => {
      console.error(`[POST /api/sessions/:id/pr] dispatch failed for ${id}:`, err);
    });

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/pr]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
