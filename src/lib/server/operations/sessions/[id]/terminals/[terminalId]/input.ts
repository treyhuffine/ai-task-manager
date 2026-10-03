import { reply, type OperationContext } from '@/lib/server/operation';
import { terminalInput, terminalInputResult } from '@/lib/terminal/operations';
import { sessionTerminalPlace, touchTerminalActivity } from '@/lib/terminal/place';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id, terminalId } = rpcInput.params;
    return await terminalInputResult(rpcInput.body, sessionTerminalPlace(id), terminalId, () => touchTerminalActivity(id));
  } catch (err) {
    console.error('[POST /api/sessions/:id/terminals/:terminalId/input]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1), "terminalId": rpcZ.string().min(1) }).strict(), body: terminalInput }).strict();
