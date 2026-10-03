import { triggers } from '@/lib/db/schema';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { createInsertSchema } from 'drizzle-zod';
import { z as rpcZ } from 'zod/v4';
/**
 * GET    /api/triggers/<id>   — fetch one
 * PATCH  /api/triggers/<id>   — update
 * DELETE /api/triggers/<id>   — delete (runs survive with triggerId=NULL)
 *
 * Sub-actions on the same route handler:
 *   POST /api/triggers/<id>?action=run      — fire immediately
 *   POST /api/triggers/<id>?action=reset    — clear consecutive_failures
 */

import { runAction } from '@/lib/orchestrator/dispatch';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const envelope = await runAction('get_trigger', { id }, { remote: false });
  if (!envelope.ok) {
    const status = envelope.error?.code === 'not_found' ? 404 : 400;
    return reply(envelope.error, { status });
  }
  return reply(envelope.result);
}

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const body = rpcInput.body;
  const envelope = await runAction('update_trigger', { id, ...body }, { remote: false });
  if (!envelope.ok) {
    return reply(envelope.error, { status: 400 });
  }
  return reply(envelope.result);
}

export async function DELETE(rpcInput: rpcZ.infer<typeof DELETEInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const envelope = await runAction('delete_trigger', { id }, { remote: false });
  if (!envelope.ok) {
    return reply(envelope.error, { status: 400 });
  }
  return reply(envelope.result);
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const params = searchParams(rpcInput.query);
  const action = params.get('action');
  if (action === 'run') {
    const envelope = await runAction('run_trigger', { id }, { remote: false });
    if (!envelope.ok) return reply(envelope.error, { status: 400 });
    return reply(envelope.result);
  }
  if (action === 'reset') {
    const envelope = await runAction(
      'reset_trigger_failures',
      { id },
      { remote: false },
    );
    if (!envelope.ok) return reply(envelope.error, { status: 400 });
    return reply(envelope.result);
  }
  return reply({ error: 'unknown action' }, { status: 400 });
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const PATCHInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: createInsertSchema(triggers).pick({ "id": true, "name": true, "userId": true, "description": true, "updatedAt": true, "workspaceId": true, "model": true, "effort": true, "timezone": true, "enabled": true, "targetKind": true, "prompt": true, "kind": true, "cronExpression": true, "intervalSeconds": true, "runAt": true, "activeHoursStart": true, "activeHoursEnd": true, "concurrencyPolicy": true, "catchUpPolicy": true, "maxCatchUpRuns": true, "owningExecutionId": true, "webhookPublicId": true, "webhookSecretHash": true, "timeoutSeconds": true, "nextRunAt": true, "lastFiredAt": true, "lastRunId": true, "lastRunStatus": true, "consecutiveFailures": true, "disabledReason": true }).partial().extend({ "skillHints": rpcZ.union([rpcZ.null(), rpcZ.array(rpcZ.string())]).optional(), "deliverResultTo": rpcZ.array(rpcZ.string()).optional(), "provider": rpcZ.enum(["cursor", "antigravity", "claude", "codex", "opencode"]).optional() }).strict().default({}) }).strict();
export const DELETEInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: createInsertSchema(triggers).pick({}).partial().strict().default({}) }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "action": rpcZ.string().optional() }).strict().optional(), body: createInsertSchema(triggers).pick({}).partial().strict().default({}) }).strict();
