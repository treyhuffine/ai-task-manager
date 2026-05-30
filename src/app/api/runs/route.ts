/**
 * GET /api/runs — list runs across all schedules + manual chats.
 *
 * Thin wrapper around the `list_runs` orchestrator action.
 */

import { NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';

/**
 * Parse a `status`/`trigger`-style param that may carry one value or a
 * comma-joined list. Returns the original string for single values
 * (matches the action's single-enum branch) and an array for multi
 * values (matches the array branch). The client's
 * `lib/api/schedules.ts` joins arrays with `,` on the wire — see
 * the `splitMulti` helper there for the matching split.
 */
function parseMulti(raw: string | null): string | string[] | undefined {
  if (raw == null) return undefined;
  if (!raw.includes(',')) return raw;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const input: Record<string, unknown> = {};
  // Multi-value filters — Zod schema unions allow string or string[].
  const status = parseMulti(params.get('status'));
  if (status !== undefined) input.status = status;
  const trigger = parseMulti(params.get('trigger'));
  if (trigger !== undefined) input.trigger = trigger;
  // Single-value scalars pass through unchanged.
  for (const key of ['scheduleId', 'agentId', 'executionId', 'workspaceId', 'since']) {
    const v = params.get(key);
    if (v != null) input[key] = v;
  }
  const limit = params.get('limit');
  if (limit) input.limit = parseInt(limit, 10);
  const envelope = await runAction('list_runs', input, { remote: false });
  if (!envelope.ok) return Response.json(envelope.error, { status: 400 });
  return Response.json(envelope.result);
}
