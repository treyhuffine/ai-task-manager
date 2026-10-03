import { reply, type OperationContext } from '@/lib/server/operation';
import { createTerminalResult, listTerminalsResult, terminalDimensions } from '@/lib/terminal/operations';
import { sessionTerminalPlace } from '@/lib/terminal/place';
import { whileOperationAdmitted as whileAdmitted } from '@/lib/transfer/moving';
import { z as rpcZ } from 'zod/v4';

/**
 * An execution's terminals, on the device it runs on, in its working folder
 * (`src/lib/terminal/place.ts`). Owned by the execution, so every chat on it
 * shares them.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return await listTerminalsResult(sessionTerminalPlace(id));
  } catch (err) {
    console.error('[GET /api/sessions/:id/terminals]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

async function handlePOST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    return await createTerminalResult(rpcInput.body, sessionTerminalPlace(id), '[POST /api/sessions/:id/terminals]');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[POST /api/sessions/:id/terminals]', err);
    return reply({ error: message }, { status: 500 });
  }
}

/** Counted while it runs, and refused while the work moves (P4 review). */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const { id } = rpcInput.params;
  return whileAdmitted(id, 'opening a terminal', () => handlePOST(rpcInput, request));
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: terminalDimensions.default({}) }).strict();
