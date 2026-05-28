import {
  findChatSessionByTakeoverToken,
  getWorkspace,
  clearExecutionTakeover,
  insertChatEvent,
} from '@/lib/db/queries';
import { openWorktreeHandle } from '@/lib/workspaces';

/**
 * POST /api/takeover/[token]/resume
 *
 * Server-side half of `flow resume`. Pulls the remote branch back into
 * the host worktree, computes the diff against the takeover base SHA,
 * inserts a synthetic user message into the chat with the diff summary,
 * and clears the takeover columns.
 *
 * Does NOT auto-dispatch the agent — the message lands in the
 * transcript and the user clicks Send to continue. Friction is
 * intentional: gives the user a final chance to add context before
 * the agent picks up.
 *
 * Bearer-authed clients (the browser "Done" button) can also hit this
 * endpoint — middleware lets through `/api/takeover/*` and the
 * token-in-path is what authenticates.
 */

export interface ResumeFromTakeoverResponse {
  ok: true;
  files_changed: number;
  shortstat: string;
  session_id: string;
}

interface FileChange {
  status: string;
  path: string;
}

function parseNameStatus(stdout: string): FileChange[] {
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split(/\s+/);
      return { status, path: rest.join(' ') };
    });
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    if (!token) return Response.json({ error: 'no_token' }, { status: 400 });

    const session = findChatSessionByTakeoverToken(token);
    if (!session) return Response.json({ error: 'unknown_token' }, { status: 404 });
    if (!session.takeover_started_at) {
      return Response.json({ error: 'not_in_takeover' }, { status: 404 });
    }
    if (
      session.takeover_token_expires_at &&
      new Date(session.takeover_token_expires_at) < new Date()
    ) {
      return Response.json({ error: 'token_expired' }, { status: 410 });
    }

    if (!session.workspace_id || !session.takeover_branch || !session.takeover_base_sha) {
      return Response.json({ error: 'inconsistent_state' }, { status: 500 });
    }
    const ws = getWorkspace(session.workspace_id);
    if (!ws) return Response.json({ error: 'workspace_not_found' }, { status: 404 });

    const handle = await openWorktreeHandle(session, ws.cwd);
    if (!handle || handle.kind !== 'git') {
      return Response.json({ error: 'worktree_unavailable' }, { status: 404 });
    }

    const baseSha = session.takeover_base_sha;
    const branch = session.takeover_branch;

    try {
      await handle.git.raw(['fetch', 'origin', branch]);
    } catch (err) {
      console.error('[resume-from-takeover] fetch failed:', err);
      return Response.json(
        { error: 'fetch_failed', message: err instanceof Error ? err.message : String(err) },
        { status: 500 },
      );
    }

    try {
      await handle.git.raw(['merge', '--ff-only', `origin/${branch}`]);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error('[resume-from-takeover] pull failed:', err);
      return Response.json(
        {
          error: 'pull_conflict',
          message:
            'Could not fast-forward the host worktree. Resolve the conflict manually via the terminal panel, or cancel and re-take. Underlying error: ' +
            message,
        },
        { status: 409 },
      );
    }

    // Collect summary stats so the synthetic message gives the agent
    // a real picture of what changed.
    let shortstat = '';
    let files: FileChange[] = [];
    let patch = '';
    try {
      const ss = await handle.git.raw(['diff', '--shortstat', `${baseSha}..HEAD`]);
      shortstat = ss.stdout.trim();
    } catch {
      /* shortstat best-effort */
    }
    try {
      const names = await handle.git.raw(['diff', '--name-status', `${baseSha}..HEAD`]);
      files = parseNameStatus(names.stdout);
    } catch {
      /* names best-effort */
    }
    try {
      const p = await handle.git.raw(['diff', `${baseSha}..HEAD`]);
      patch = p.stdout;
    } catch {
      /* patch best-effort — the message still includes shortstat + names */
    }

    // Cap the inline patch to keep the synthetic message bounded.
    // 200k chars matches the attachment text cap documented in CLAUDE.md.
    const MAX_PATCH_CHARS = 200_000;
    const patchTrimmed =
      patch.length > MAX_PATCH_CHARS
        ? patch.slice(0, MAX_PATCH_CHARS) + `\n\n... (truncated, ${patch.length - MAX_PATCH_CHARS} more chars)`
        : patch;

    const filesList =
      files.length > 0
        ? files.map((f) => `- ${f.status}\t${f.path}`).join('\n')
        : '(no file-level changes detected)';

    const content = [
      `I took the session over locally at ${session.takeover_started_at}.`,
      shortstat ? `Summary: ${shortstat}` : 'Summary: (no shortstat available)',
      '',
      'Files changed:',
      filesList,
      '',
      patchTrimmed ? 'Diff:\n```diff\n' + patchTrimmed + '\n```' : '(no diff available)',
      '',
      'Continue from this state.',
    ].join('\n');

    insertChatEvent({
      session_id: session.id,
      role: 'user',
      source: 'system',
      content,
      created_at: new Date().toISOString(),
    });

    if (session.execution_id) clearExecutionTakeover(session.execution_id);

    const body: ResumeFromTakeoverResponse = {
      ok: true,
      files_changed: files.length,
      shortstat,
      session_id: session.id,
    };
    return Response.json(body);
  } catch (err) {
    console.error('[POST /api/takeover/:token/resume]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
