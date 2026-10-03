import { reply, type OperationContext } from '@/lib/server/operation';
import { z } from 'zod/v4';
/**
 * Find-or-create the dev page's scratch session. Idempotent — every
 * call returns the same session id for the same caller (single-user app
 * = one scratch session globally).
 *
 * Scratch infrastructure:
 *   - workspace slug `__dev_scratch__`, name "Dev scratch", non-git so
 *     execution sessions skip worktree provisioning entirely.
 *   - cwd points at the OS tmpdir — fine for dev because we never run
 *     real tools against it (inject path doesn't reach the agent;
 *     live path does, and prompts canned for dev should never write).
 *   - Reuses the most recent active session in the workspace; creates
 *     one when none exists.
 *
 * Cleanup is the user's responsibility via the dev page's reset button,
 * which calls `/inject { kind: 'reset_session' }` to wipe events.
 */

import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createExecutionSession, createWorkspace, getUserState, listChatSessions, listWorkspaces } from '@/lib/db/queries';
import { DEFAULT_HARNESS } from '@/lib/harness/registry';

const SCRATCH_SLUG = '__dev_scratch__';
const SCRATCH_CWD = join(tmpdir(), 'ri-dev-scratch');

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_input: z.infer<typeof GETInput>, _context: OperationContext) {
  if (process.env.NODE_ENV === 'production') return reply({ error: 'Not found' }, { status: 404 });
  try {

    // Ensure the cwd exists before any agent dispatch tries to spawn
    // there — Claude exits immediately if cwd is missing. recursive:true
    // is idempotent.
    mkdirSync(SCRATCH_CWD, { recursive: true });

    const found = listWorkspaces().find(workspace => workspace.slug === SCRATCH_SLUG);

    const workspace = found ?? createWorkspace({ name: 'Dev scratch', slug: SCRATCH_SLUG, cwd: SCRATCH_CWD, isGit: false });

    const existing = listChatSessions({ workspaceId: workspace.id, status: 'active', type: 'execution' }).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];

    const session = existing ?? createExecutionSession({
      workspaceId: workspace.id,
      label: 'Dev scratch session',
      harness: getUserState()?.defaultHarness ?? DEFAULT_HARNESS,
    });
    return reply({ session, workspace });
  } catch (err) {
    console.error('[GET /api/dev/sessions/scratch]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = z.object({}).strict().default({});
