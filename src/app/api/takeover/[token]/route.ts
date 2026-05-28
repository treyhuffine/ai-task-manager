import os from 'node:os';
import {
  findChatSessionByTakeoverToken,
  getWorkspace,
} from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';

/**
 * GET /api/takeover/[token]
 *
 * Token-authed endpoint the laptop CLI calls. Resolves the takeover
 * token to clone info: workspace id, remote URL, branch, base SHA.
 * Returns 404 when the token is unknown or already cleared (resumed/
 * cancelled), 410 when expired.
 *
 * Exempt from the bearer-token middleware via `proxy.ts`'s prefix
 * allowlist. The token itself IS the auth — no other credential needed.
 */

export interface TakeoverInfoResponse {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  remoteUrl: string;
  branch: string;
  baseSha: string;
  hostLabel: string;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!token) return Response.json({ error: 'no_token' }, { status: 400 });

    const session = findChatSessionByTakeoverToken(token);
    if (!session) {
      return Response.json({ error: 'unknown_token' }, { status: 404 });
    }
    if (!session.takeoverStartedAt) {
      return Response.json({ error: 'not_in_takeover' }, { status: 404 });
    }
    if (
      session.takeoverTokenExpiresAt &&
      new Date(session.takeoverTokenExpiresAt) < new Date()
    ) {
      return Response.json({ error: 'token_expired' }, { status: 410 });
    }

    if (!session.workspaceId || !session.takeoverBranch || !session.takeoverBaseSha) {
      return Response.json({ error: 'inconsistent_state' }, { status: 500 });
    }
    const ws = getWorkspace(session.workspaceId);
    if (!ws) return Response.json({ error: 'workspace_not_found' }, { status: 404 });

    // Re-resolve the remote URL from the worktree so it's authoritative
    // and reflects any post-takeover remote changes the user might have
    // made. The takeover row doesn't store remoteUrl precisely because
    // it can drift; the branch and SHA are the only frozen-in-time bits.
    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'worktree_unavailable' }, { status: 404 });
    }
    const remoteResult = await handle.git.raw(['remote', 'get-url', 'origin']);
    const remoteUrl = remoteResult.stdout.trim();
    if (!remoteUrl) {
      return Response.json({ error: 'no_remote' }, { status: 500 });
    }

    const body: TakeoverInfoResponse = {
      sessionId: session.id,
      workspaceId: ws.id,
      workspaceName: ws.name,
      remoteUrl: remoteUrl,
      branch: session.takeoverBranch,
      baseSha: session.takeoverBaseSha,
      hostLabel: os.hostname(),
    };
    return Response.json(body);
  } catch (err) {
    console.error('[GET /api/takeover/:token]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
