import { reply, type OperationContext } from '@/lib/server/operation';
import { terminalResize, terminalResizeResult } from '@/lib/terminal/operations';
import { sessionTerminalPlace } from '@/lib/terminal/place';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id, terminalId } = rpcInput.params;
    return await terminalResizeResult(rpcInput.body, sessionTerminalPlace(id), terminalId);
  } catch (err) {
    console.error('[POST /api/sessions/:id/terminals/:terminalId/resize]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "terminalId": rpcZ.string().min(1) }).strict(), body: terminalResize }).strict();
