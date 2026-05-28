import type { NextRequest } from 'next/server';
import { getChatSessionWithExecution, getAgent, updateChatSession, setExecutionPR } from '@/lib/db/queries';
import { PERMISSION_MODES, EFFORT_LEVELS, type PermissionMode, type EffortLevel } from '@/db/types';
import * as executor from '@/lib/executor/adapter';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = getChatSessionWithExecution(id);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    // Sidecar `agentHarness` so the composer can pick the right model
    // catalog without a second round-trip. Cheap join; the agent row is
    // immutable for the session's lifetime.
    const agent = getAgent(row.agentId);
    return Response.json({ ...row, agentHarness: agent?.harness ?? null });
  } catch (err) {
    console.error('[GET /api/sessions/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

interface PatchBody {
  label?: string | null;
  permissionMode?: PermissionMode;
  /** Provider model id. `null` clears back to the harness default. */
  model?: string | null;
  /** Effort level (Claude only — Codex ignores). `null` clears. */
  effort?: EffortLevel | null;
  /** Explicit PR link. `null` clears the link. */
  prNumber?: number | null;
}

/**
 * Updates a small whitelist of session fields. Label is freeform; other
 * mutations have dedicated routes (`/view`, `/archive`, etc.) so this is
 * intentionally narrow rather than a generic "update session".
 *
 * `permissionMode` change behavior: the row is updated, then the
 * cached AgentSession (if any) is closed via `executor.recycleForModeChange`.
 * The next dispatch reopens the CLI with the new `--permission-mode`
 * flag and resumes the conversation via `externalSessionId`. We don't
 * await the close — the route returns as soon as the row update lands.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PatchBody = await request.json();

    const existing = getChatSessionWithExecution(id);
    if (!existing) return Response.json({ error: 'Session not found' }, { status: 404 });

    const updates: PatchBody = {};
    if ('label' in body) {
      const trimmed = typeof body.label === 'string' ? body.label.trim() : null;
      updates.label = trimmed || null;
    }
    // Track whether any executor-relevant field changed; if so, recycle
    // the cached AgentSession so the next dispatch spawns a fresh CLI
    // process with the new --permission-mode / --model / --effort flags.
    let executorChanged = false;
    if ('permissionMode' in body) {
      const mode = body.permissionMode;
      if (!mode || !PERMISSION_MODES.includes(mode)) {
        return Response.json(
          { error: `Invalid permissionMode. Expected one of ${PERMISSION_MODES.join(', ')}.` },
          { status: 400 },
        );
      }
      if (mode !== existing.permissionMode) {
        updates.permissionMode = mode;
        executorChanged = true;
        // Track prior mode on plan entry so ExitPlanMode can revert.
        // Cleared on any non-plan transition. Mirrors Claude Code's
        // ToolPermissionContext.prePlanMode behavior.
        if (mode === 'plan' && existing.permissionMode !== 'plan') {
          (updates as Record<string, unknown>).prePlanMode = existing.permissionMode;
        } else if (mode !== 'plan' && existing.prePlanMode) {
          (updates as Record<string, unknown>).prePlanMode = null;
        }
      }
    }
    if ('model' in body) {
      const model = body.model === null ? null : (body.model ?? '').trim() || null;
      if (model !== existing.model) {
        updates.model = model;
        executorChanged = true;
      }
    }
    if ('effort' in body) {
      const effort = body.effort;
      if (effort !== null && (effort === undefined || !EFFORT_LEVELS.includes(effort))) {
        return Response.json(
          { error: `Invalid effort. Expected null or one of ${EFFORT_LEVELS.join(', ')}.` },
          { status: 400 },
        );
      }
      if (effort !== existing.effort) {
        updates.effort = effort;
        executorChanged = true;
      }
    }
    // prNumber was lifted off chat_sessions onto the execution. Route it
    // to the execution row rather than the chat update below.
    let prChanged = false;
    if ('prNumber' in body) {
      const num = body.prNumber;
      if (num !== null && (typeof num !== 'number' || !Number.isInteger(num) || num <= 0)) {
        return Response.json(
          { error: 'Invalid prNumber. Expected a positive integer or null.' },
          { status: 400 },
        );
      }
      if (existing.executionId && num !== existing.prNumber) {
        setExecutionPR(existing.executionId, num ?? null);
        prChanged = true;
      }
    }

    // No-op when nothing on the chat row changed (e.g. PATCH with
    // permissionMode matching the current value). Drizzle's update()
    // throws "No values to set" with an empty patch, so short-circuit. A
    // prNumber-only change is applied to the execution above, so reload
    // the flattened row to reflect it.
    if (Object.keys(updates).length === 0) {
      return Response.json(prChanged ? getChatSessionWithExecution(id) : existing);
    }

    const row = updateChatSession(id, updates);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });

    if (executorChanged) {
      // Fire-and-forget: a fresh CLI process spawns on the next message.
      executor.recycleForModeChange(id).catch((err) => {
        console.error(`[PATCH /api/sessions/:id] recycleForModeChange failed for ${id}:`, err);
      });
    }

    // Return the flattened row so the client sees worktree/branch/pr state
    // sourced from the execution, consistent with GET.
    return Response.json(getChatSessionWithExecution(id));
  } catch (err) {
    console.error('[PATCH /api/sessions/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
