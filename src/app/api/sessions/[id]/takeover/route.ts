import type { NextRequest } from 'next/server';
import { headers } from 'next/headers';
import { randomUUID } from 'node:crypto';
import {
  getChatSessionWithExecution,
  getWorkspace,
  startExecutionTakeover,
} from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';
import * as executor from '@/lib/executor/adapter';

/**
 * Start a "Take over locally" session.
 *
 * Pauses the agent, WIP-commits any dirty work, pushes the execution
 * branch to origin, mints a short-lived token, and stamps the takeover
 * columns on chat_sessions. Returns enough for the modal to render
 * the copy-paste CLI command and the fallback git instructions.
 *
 * The session is "in takeover" until the user runs `flow resume`
 * (or clicks Done/Cancel in the browser). While taken over, dispatches
 * into the executor are rejected.
 */

export interface TakeoverResponse {
  token: string;
  expiresAt: string;
  cliCommand: string;
  fallbackCommand: string;
  branch: string;
  baseSha: string;
  remoteUrl: string;
  workspaceId: string;
  startedAt: string;
}

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

/** Wait up to `timeoutMs` for the running flag to clear. Cheap polling
 *  beats threading a Promise out of the executor adapter; the loop only
 *  runs for at most a few hundred ms in practice. */
async function waitForIdle(sessionId: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (!executor.isRunning(sessionId)) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return false;
}

/** Build a token CLI users paste into their laptop terminal. Uses the
 *  origin the browser is reaching us at so it works through tunnels
 *  (Tailscale, ngrok) without any host-side config. */
function buildCliCommand(origin: string, token: string): string {
  const base = origin.replace(/\/+$/, '');
  return `flow takeover ${base}/t/${token}`;
}

function buildFallbackCommand(branch: string): string {
  return `git fetch origin && git checkout ${branch}`;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const session = getChatSessionWithExecution(id);
    if (!session) {
      return Response.json({ error: 'Session not found' }, { status: 404 });
    }
    if (session.status === 'archived') {
      return Response.json(
        { error: 'archived', message: 'Cannot take over an archived session.' },
        { status: 400 },
      );
    }
    if (session.takeoverStartedAt) {
      return Response.json(
        { error: 'already_taken_over', message: 'Session is already in takeover.' },
        { status: 409 },
      );
    }
    if (!session.workspaceId || !session.worktreePath || !session.branchName || !session.executionId) {
      return Response.json(
        { error: 'noWorktree', message: 'Session has no worktree to take over.' },
        { status: 400 },
      );
    }
    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json({ error: 'Workspace not found' }, { status: 404 });
    if (!ws.isGit) {
      return Response.json({ error: 'not_git', message: 'Workspace is not a git repo.' }, { status: 400 });
    }

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'Worktree unavailable' }, { status: 404 });
    }

    // Wait briefly for any in-flight tool call to settle before
    // shoving a WIP commit in front of it. If it doesn't drain in
    // time, interrupt — same approach the existing interrupt route
    // takes; the agent loses its in-flight turn but the user's
    // takeover takes priority.
    const settled = await waitForIdle(id, 5000);
    if (!settled) {
      try {
        await executor.abort(id);
      } catch (err) {
        console.error('[takeover] abort during in-flight turn failed:', err);
      }
    }

    // Refuse to operate if no `origin` remote — we can't hand the user
    // a clone command for a repo that doesn't have one.
    const remoteResult = await handle.git.raw(['remote', 'get-url', 'origin']);
    const remoteUrl = remoteResult.stdout.trim();
    if (!remoteUrl) {
      return Response.json(
        {
          error: 'no_remote',
          message: 'Workspace has no `origin` remote. Configure one with `git remote add origin <url>` and retry.',
        },
        { status: 400 },
      );
    }

    // WIP commit any dirty changes so the push captures the full
    // working state. `git.commit()` stages everything and is a no-op
    // for nothing-to-commit; we check status first to avoid the throw.
    const status = await handle.git.status();
    if (status.dirty) {
      try {
        await handle.git.commit(`WIP: takeover at ${new Date().toISOString()}`);
      } catch (err) {
        console.error('[takeover] WIP commit failed:', err);
        return Response.json(
          { error: 'wip_commit_failed', message: err instanceof Error ? err.message : String(err) },
          { status: 500 },
        );
      }
    }

    // Capture HEAD AFTER the WIP commit so resume diffs against the
    // commit the user actually got locally — not the pre-WIP state.
    const headResult = await handle.git.raw(['rev-parse', 'HEAD']);
    const baseSha = headResult.stdout.trim();

    try {
      await handle.git.push();
    } catch (err) {
      console.error('[takeover] push failed:', err);
      return Response.json(
        { error: 'push_failed', message: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }

    const token = randomUUID().replace(/-/g, '');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_MS).toISOString();

    const updated = startExecutionTakeover(session.executionId, {
      baseSha: baseSha,
      branch: session.branchName,
      token,
      expiresAt: expiresAt,
      // Pin the chat that initiated the takeover so resume lands in
      // *this* chat even when sibling chats accumulate on the
      // execution (recurring trigger fires).
      chatSessionId: id,
    });
    if (!updated) {
      return Response.json({ error: 'persist_failed' }, { status: 500 });
    }

    const reqHeaders = await headers();
    const proto = reqHeaders.get('x-forwarded-proto') ?? 'http';
    const host = reqHeaders.get('host') ?? 'localhost';
    const origin = `${proto}://${host}`;

    const body: TakeoverResponse = {
      token,
      expiresAt: expiresAt,
      cliCommand: buildCliCommand(origin, token),
      fallbackCommand: buildFallbackCommand(session.branchName),
      branch: session.branchName,
      baseSha: baseSha,
      remoteUrl: remoteUrl,
      workspaceId: session.workspaceId,
      startedAt: updated.takeoverStartedAt ?? new Date().toISOString(),
    };
    return Response.json(body);
  } catch (err) {
    console.error('[POST /api/sessions/:id/takeover]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
