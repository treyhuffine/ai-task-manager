import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * GET /api/runs — list runs across all triggers + manual chats.
 *
 * Thin wrapper around the `list_runs` orchestrator action.
 */

import { runAction } from '@/lib/orchestrator/dispatch';

/**
 * Parse a `status`/`trigger`-style param that may carry one value or a
 * comma-joined list. Returns the original string for single values
 * (matches the action's single-enum branch) and an array for multi
 * values (matches the array branch). The client's
 * `lib/api/triggers.ts` joins arrays with `,` on the wire — see
 * the `splitMulti` helper there for the matching split.
 */
function parseMulti(raw: string | null): string | string[] | undefined {
  if (raw == null) return undefined;
  if (!raw.includes(',')) return raw;
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const params = searchParams(rpcInput.query);
  const input: Record<string, unknown> = {};
  // Multi-value filters — Zod schema unions allow string or string[].
  const status = parseMulti(params.get('status'));
  if (status !== undefined) input.status = status;
  const trigger = parseMulti(params.get('trigger'));
  if (trigger !== undefined) input.trigger = trigger;
  // Single-value scalars pass through unchanged. `agentId` is forwarded only
  // so the action rejects it loudly (the old agents table is gone, use
  // `harness`), rather than being dropped into an unfiltered list.
  for (const key of ['triggerId', 'harness', 'agentId', 'executionId', 'workspaceId', 'since']) {
    const v = params.get(key);
    if (v != null) input[key] = v;
  }
  const limit = params.get('limit');
  if (limit) input.limit = parseInt(limit, 10);
  const envelope = await runAction('list_runs', input, { remote: false });
  if (!envelope.ok) return reply(envelope.error, { status: 400 });
  return reply(envelope.result);
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "triggerId": rpcZ.string().optional(), "harness": rpcZ.string().optional(), "agentId": rpcZ.string().optional(), "executionId": rpcZ.string().optional(), "workspaceId": rpcZ.string().optional(), "since": rpcZ.string().optional(), "status": rpcZ.string().optional(), "trigger": rpcZ.string().optional(), "limit": rpcZ.string().optional() }).strict().optional() }).strict().default({});
