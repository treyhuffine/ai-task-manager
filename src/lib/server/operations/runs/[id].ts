import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * GET  /api/runs/<id>          — fetch one
 * POST /api/runs/<id>?action=cancel — best-effort cancel
 */

import { runAction } from '@/lib/orchestrator/dispatch';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const envelope = await runAction('get_run', { id }, { remote: false });
  if (!envelope.ok) {
    const status = envelope.error?.code === 'not_found' ? 404 : 400;
    return reply(envelope.error, { status });
  }
  return reply(envelope.result);
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  const { id } = rpcInput.params;
  const action = searchParams(rpcInput.query).get('action');
  if (action === 'cancel') {
    const envelope = await runAction('cancel_run', { id }, { remote: false });
    if (!envelope.ok) return reply(envelope.error, { status: 400 });
    return reply(envelope.result);
  }
  return reply({ error: 'unknown action' }, { status: 400 });
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "action": rpcZ.string().optional() }).strict().optional(), body: rpcZ.object({}).strict().default({}) }).strict();
