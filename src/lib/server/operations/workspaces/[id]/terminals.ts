import { reply, type OperationContext } from '@/lib/server/operation';
import { createTerminalResult, listTerminalsResult, terminalDimensions } from '@/lib/terminal/operations';
import { agentTerminalPlace } from '@/lib/terminal/place';
import { z as rpcZ } from 'zod/v4';

/**
 * The agent's own terminals, on the device it lives on, in its folder there
 * (the source checkout for a git agent). Owned by the workspace, separate from
 * every execution's shells. Same shapes as `/api/sessions/:id/terminals`.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return await listTerminalsResult(agentTerminalPlace(id));
  } catch (err) {
    console.error('[GET /api/workspaces/:id/terminals]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return await createTerminalResult(rpcInput.body, agentTerminalPlace(id), '[POST /api/workspaces/:id/terminals]');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/workspaces/:id/terminals]', err);
    return reply({ error: message }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: terminalDimensions.default({}) }).strict();
