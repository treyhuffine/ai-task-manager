import type { NextRequest } from 'next/server';
import { retrySetupScript } from '@/lib/sessions/dispatch';

/**
 * Re-run the workspace setup script (deps install) for an execution.
 * Execution-keyed companion to `/api/sessions/:id/retry-setup-script` — the
 * preview pane knows the execution, not the chat session, and surfaces a
 * "Re-run setup" recovery when the dev server can't start because dependencies
 * are missing (failed/stale/never-ran setup). Fires in the background; the
 * execution's `setupScriptStatus` flips to 'running' synchronously and the
 * preview gate holds Start until it lands.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const ok = retrySetupScript(id);
    if (!ok) {
      return Response.json(
        { error: 'No setup script to run (no worktree or no setup command configured).' },
        { status: 400 },
      );
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/executions/:id/retry-setup-script]', err);
    const message = err instanceof Error ? err.message : String(err);
    return Response.json({ error: 'retry_failed', message }, { status: 500 });
  }
}
