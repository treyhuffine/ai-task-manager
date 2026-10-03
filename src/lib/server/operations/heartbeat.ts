import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * GET /api/heartbeat  — the heartbeat's settings and status
 * PUT /api/heartbeat  — change any of its settings (partial)
 *
 * Server-side wrapper around the orchestrator's `get_heartbeat` and
 * `update_heartbeat` actions, so Settings, the deck chip, the CLI, and agents
 * all share one validated path. "Check in now" is `run_trigger` on the
 * returned `triggerId` (POST /api/triggers/:id?action=run).
 * See docs/heartbeat-spec.md §6.
 */

import { runAction } from '@/lib/orchestrator/dispatch';

// Compressed when the body is JSON and over ~1KiB. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const envelope = await runAction('get_heartbeat', {}, { remote: false });
  if (!envelope.ok) return reply(envelope.error, { status: 500 });
  return reply(envelope.result);
}

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  const body = rpcInput.body;
  const envelope = await runAction('update_heartbeat', body, { remote: false });
  if (!envelope.ok) {
    const status = envelope.error?.code === 'invalid_params' || envelope.error?.code === 'not_found' ? 400 : 500;
    return reply(envelope.error, { status });
  }
  return reply(envelope.result);
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PUTInput = rpcZ.object({ body: rpcZ.object({ "enabled": rpcZ.boolean().optional(), "instructions": rpcZ.string().optional(), "resetInstructions": rpcZ.boolean().optional(), "intervalSeconds": rpcZ.number().finite().optional(), "activeHoursStart": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "activeHoursEnd": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "timezone": rpcZ.string().optional(), "provider": rpcZ.enum(["cursor", "antigravity", "claude", "codex", "opencode"]).optional(), "model": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional(), "effort": rpcZ.union([rpcZ.null(), rpcZ.literal("low"), rpcZ.literal("medium"), rpcZ.literal("high"), rpcZ.literal("xhigh"), rpcZ.literal("max"), rpcZ.literal("ultra")]).optional(), "deliverResultTo": rpcZ.array(rpcZ.string()).optional() }).strict().default({}) }).strict();
