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

import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync } from 'node:fs';
import { eq, and, desc } from 'drizzle-orm';
import { getDb } from '@/lib/db';
import { workspaces, chatSessions } from '@/lib/db/schema';
import { createWorkspace, createExecutionSession, getAgent } from '@/lib/db/queries';
import { hydrateRow } from '@/lib/db/hydrate';

const SCRATCH_SLUG = '__dev_scratch__';
const SCRATCH_CWD = join(tmpdir(), 'flow-dev-scratch');

export async function GET() {
  try {
    const db = getDb();

    // Ensure the cwd exists before any agent dispatch tries to spawn
    // there — Claude exits immediately if cwd is missing. recursive:true
    // is idempotent.
    mkdirSync(SCRATCH_CWD, { recursive: true });

    let workspace = hydrateRow(db
      .select()
      .from(workspaces)
      .where(eq(workspaces.slug, SCRATCH_SLUG))
      .get());

    if (!workspace) {
      workspace = createWorkspace({
        name: 'Dev scratch',
        slug: SCRATCH_SLUG,
        cwd: SCRATCH_CWD,
        isGit: false,
      });
    }

    const existing = db
      .select()
      .from(chatSessions)
      .where(
        and(
          eq(chatSessions.workspaceId, workspace.id),
          eq(chatSessions.type, 'execution'),
          eq(chatSessions.status, 'active'),
        ),
      )
      .orderBy(desc(chatSessions.startedAt))
      .limit(1)
      .get();

    const session = existing ?? createExecutionSession({
      workspaceId: workspace.id,
      label: 'Dev scratch session',
    });
    const agent = getAgent(session.agentId);
    return Response.json({
      session: { ...session, agentHarness: agent?.harness ?? null },
      workspace,
    });
  } catch (err) {
    console.error('[GET /api/dev/sessions/scratch]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
