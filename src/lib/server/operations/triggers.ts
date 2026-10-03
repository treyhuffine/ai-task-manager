import { triggers } from '@/lib/db/schema';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { createInsertSchema } from 'drizzle-zod';
import { z as rpcZ } from 'zod/v4';
/**
 * GET  /api/triggers  — list with optional filters
 * POST /api/triggers  — create
 *
 * Server-side wrapper around the orchestrator's `list_triggers` and
 * `create_trigger` actions so the UI gets the same validation +
 * derived behavior the CLI and MCP get.
 */

import { runAction } from '@/lib/orchestrator/dispatch';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const params = searchParams(rpcInput.query);
  const input: Record<string, unknown> = {};
  const enabled = params.get('enabled');
  if (enabled === 'true') input.enabled = true;
  else if (enabled === 'false') input.enabled = false;
  const workspaceId = params.get('workspaceId');
  if (workspaceId === 'null') input.workspaceId = null;
  else if (workspaceId) input.workspaceId = workspaceId;
  const targetKind = params.get('targetKind');
  if (targetKind) input.targetKind = targetKind;

  const envelope = await runAction('list_triggers', input, { remote: false });
  if (!envelope.ok) {
    return reply(envelope.error, { status: 400 });
  }
  return reply(envelope.result);
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const body = rpcInput.body;
  const envelope = await runAction('create_trigger', body, { remote: false });
  if (!envelope.ok) {
    return reply(envelope.error, { status: 400 });
  }
  return reply(envelope.result, { status: 201 });
}

export const GETInput = rpcZ.object({ query: rpcZ.object({ "enabled": rpcZ.string().optional(), "workspaceId": rpcZ.string().optional(), "targetKind": rpcZ.string().optional() }).strict().optional() }).strict().default({});
export const POSTInput = rpcZ.object({ body: createInsertSchema(triggers).pick({ "id": true, "name": true, "userId": true, "description": true, "createdAt": true, "updatedAt": true, "workspaceId": true, "model": true, "effort": true, "timezone": true, "enabled": true, "targetKind": true, "prompt": true, "kind": true, "cronExpression": true, "intervalSeconds": true, "runAt": true, "activeHoursStart": true, "activeHoursEnd": true, "concurrencyPolicy": true, "catchUpPolicy": true, "maxCatchUpRuns": true, "owningExecutionId": true, "webhookPublicId": true, "webhookSecretHash": true, "timeoutSeconds": true, "nextRunAt": true, "lastFiredAt": true, "lastRunId": true, "lastRunStatus": true, "consecutiveFailures": true, "disabledReason": true }).partial().extend({ "name": createInsertSchema(triggers).shape.name, "targetKind": createInsertSchema(triggers).shape.targetKind, "prompt": createInsertSchema(triggers).shape.prompt, "skillHints": rpcZ.union([rpcZ.null(), rpcZ.array(rpcZ.string())]).optional(), "kind": createInsertSchema(triggers).shape.kind, "deliverResultTo": rpcZ.array(rpcZ.string()).optional(), "provider": rpcZ.enum(["cursor", "antigravity", "claude", "codex", "opencode"]).optional() }).strict() }).strict();
