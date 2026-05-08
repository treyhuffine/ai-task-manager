import type { NextRequest } from 'next/server';
import { getPending, resolveRequest } from '@/lib/executor/pending-input';

interface ResolveBody {
  /** True for permission allow + AskUserQuestion answer; false for deny. */
  allow?: boolean;
  /** Optional reason shown back to the agent when denying. */
  message?: string;
  /** AskUserQuestion answers keyed by question text. Ignored for permission requests. */
  answers?: Record<string, string>;
}

/**
 * Resolve a pending permission/question request.
 *
 * For permission requests, the body is `{ allow: boolean, message? }`.
 * For AskUserQuestion, the body is `{ answers }` — we wrap it as
 * `updatedInput.answers` per the agentex contract.
 *
 * Idempotency: a duplicate POST with the same requestId returns 410. The
 * UI removes the pending entry on success so a retry would only fire if
 * two clients race to answer the same prompt — fine to surface as
 * "already resolved" rather than silently double-allow.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; requestId: string }> },
) {
  try {
    const { id, requestId } = await params;
    const body: ResolveBody = await request.json().catch(() => ({}));

    const pending = getPending(requestId);
    if (!pending) {
      return Response.json(
        { error: 'gone', message: 'Request is no longer pending.' },
        { status: 410 },
      );
    }
    if (pending.sessionId !== id) {
      return Response.json(
        { error: 'mismatch', message: 'Request does not belong to this session.' },
        { status: 400 },
      );
    }

    const allow = body.allow ?? false;

    // Claude's PermissionAllowResultSchema requires `updatedInput`
    // (`record`) on every allow, and PermissionDenyResultSchema requires
    // a non-empty `message` on every deny. Defaulting both here is
    // load-bearing: a missing field gets reported back to the agent as
    // a Zod error, and the agent retries forever. See
    // claude-code/src/utils/permissions/PermissionPromptToolResultSchema.ts.
    const denyMessage = body.message?.trim() || 'Denied by user.';

    if (pending.kind === 'question') {
      const answers = body.answers ?? {};
      const result = resolveRequest(
        requestId,
        allow
          ? { allow: true, updatedInput: { ...pending.originalInput, answers } }
          : { allow: false, message: denyMessage },
      );
      if (!result.ok) {
        return Response.json({ error: 'gone' }, { status: 410 });
      }
      return Response.json({ ok: true });
    }

    // Permission allow: pass through the original input as updatedInput
    // (no rewrite). Claude treats an empty record as "use original";
    // we send the original explicitly so any future host that wants to
    // log what was approved sees the actual call shape.
    const result = resolveRequest(
      requestId,
      allow
        ? { allow: true, updatedInput: pending.input }
        : { allow: false, message: denyMessage },
    );
    if (!result.ok) {
      return Response.json({ error: 'gone' }, { status: 410 });
    }
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/sessions/:id/pending-input/:requestId]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
