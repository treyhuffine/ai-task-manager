import { reply, type OperationContext } from '@/lib/server/operation';
import { retrySetupScript } from '@/lib/sessions/dispatch';
import { z as rpcZ } from 'zod/v4';

/**
 * Re-run the workspace setup script (deps install) for an execution.
 * Execution-keyed companion to `/api/sessions/:id/retry-setup-script` — the
 * preview pane knows the execution, not the chat session, and surfaces a
 * "Re-run setup" recovery when the dev server can't start because dependencies
 * are missing (failed/stale/never-ran setup). Fires in the background; the
 * execution's `setupScriptStatus` flips to 'running' synchronously and the
 * preview gate holds Start until it lands.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const ok = retrySetupScript(id);
    if (!ok) {
      return reply(
        { error: 'No setup script to run (no worktree or no setup command configured).' },
        { status: 400 },
      );
    }
    return reply({ ok: true });
  } catch (err) {
    console.error('[POST /api/executions/:id/retry-setup-script]', err);
    const message = err instanceof Error ? err.message : String(err);
    return reply({ error: 'retry_failed', message }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
