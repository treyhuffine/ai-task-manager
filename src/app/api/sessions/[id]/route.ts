import type { NextRequest } from 'next/server';
import { getChatSession, getAgent, updateChatSession } from '@/lib/db/queries';
import { PERMISSION_MODES, EFFORT_LEVELS, type PermissionMode, type EffortLevel } from '@/db/types';
import * as executor from '@/lib/executor/adapter';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const row = getChatSession(id);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });
    // Sidecar `agent_harness` so the composer can pick the right model
    // catalog without a second round-trip. Cheap join; the agent row is
    // immutable for the session's lifetime.
    const agent = getAgent(row.agent_id);
    return Response.json({ ...row, agent_harness: agent?.harness ?? null });
  } catch (err) {
    console.error('[GET /api/sessions/:id]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

interface PatchBody {
  label?: string | null;
  permission_mode?: PermissionMode;
  /** Provider model id. `null` clears back to the harness default. */
  model?: string | null;
  /** Effort level (Claude only — Codex ignores). `null` clears. */
  effort?: EffortLevel | null;
  /** Explicit PR link. `null` clears the link. */
  pr_number?: number | null;
}

/**
 * Updates a small whitelist of session fields. Label is freeform; other
 * mutations have dedicated routes (`/view`, `/archive`, etc.) so this is
 * intentionally narrow rather than a generic "update session".
 *
 * `permission_mode` change behavior: the row is updated, then the
 * cached AgentSession (if any) is closed via `executor.recycleForModeChange`.
 * The next dispatch reopens the CLI with the new `--permission-mode`
 * flag and resumes the conversation via `external_session_id`. We don't
 * await the close — the route returns as soon as the row update lands.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body: PatchBody = await request.json();

    const existing = getChatSession(id);
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
    if ('permission_mode' in body) {
      const mode = body.permission_mode;
      if (!mode || !PERMISSION_MODES.includes(mode)) {
        return Response.json(
          { error: `Invalid permission_mode. Expected one of ${PERMISSION_MODES.join(', ')}.` },
          { status: 400 },
        );
      }
      if (mode !== existing.permission_mode) {
        updates.permission_mode = mode;
        executorChanged = true;
        // Track prior mode on plan entry so ExitPlanMode can revert.
        // Cleared on any non-plan transition. Mirrors Claude Code's
        // ToolPermissionContext.prePlanMode behavior.
        if (mode === 'plan' && existing.permission_mode !== 'plan') {
          (updates as Record<string, unknown>).pre_plan_mode = existing.permission_mode;
        } else if (mode !== 'plan' && existing.pre_plan_mode) {
          (updates as Record<string, unknown>).pre_plan_mode = null;
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
    if ('pr_number' in body) {
      const num = body.pr_number;
      if (num !== null && (typeof num !== 'number' || !Number.isInteger(num) || num <= 0)) {
        return Response.json(
          { error: 'Invalid pr_number. Expected a positive integer or null.' },
          { status: 400 },
        );
      }
      if (num !== existing.pr_number) {
        updates.pr_number = num;
      }
    }

    // No-op when nothing actually changed (e.g. PATCH with permission_mode
    // matching the current value). Drizzle's update() throws "No values to
    // set" with an empty patch, so short-circuit instead. The dev page
    // hits this path on every Live click that doesn't switch modes.
    if (Object.keys(updates).length === 0) {
      return Response.json(existing);
    }

    const row = updateChatSession(id, updates);
    if (!row) return Response.json({ error: 'Session not found' }, { status: 404 });

    if (executorChanged) {
      // Fire-and-forget: a fresh CLI process spawns on the next message.
      executor.recycleForModeChange(id).catch((err) => {
        console.error(`[PATCH /api/sessions/:id] recycleForModeChange failed for ${id}:`, err);
      });
    }

    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/sessions/:id]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
