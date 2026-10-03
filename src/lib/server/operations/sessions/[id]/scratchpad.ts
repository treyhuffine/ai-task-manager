import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';
/**
 * Session scratchpad. One blob of markdown per session — see the
 * `scratchPad` column on `chat_sessions` (schema.ts).
 *
 * GET returns the current text. PUT replaces it. The agent reads the
 * latest version at hydration time (expandEntityMarkers), so write
 * order doesn't matter for the model's view — last write wins.
 */
import { getChatSession, setSessionScratchPad } from '@/lib/db/queries';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    return reply({ scratchPad: session.scratchPad });
  } catch (err) {
    console.error('[GET /api/sessions/:id/scratchpad]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

interface PutBody {
  scratchPad?: string | null;
}

export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const body: PutBody = rpcInput.body;
    const next = body.scratchPad ?? null;
    const session = getChatSession(id);
    if (!session) return reply({ error: 'Session not found' }, { status: 404 });
    const updated = setSessionScratchPad(id, next === '' ? null : next);
    return reply({ scratchPad: updated?.scratchPad ?? null });
  } catch (err) {
    console.error('[PUT /api/sessions/:id/scratchpad]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
export const PUTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({ "scratchPad": rpcZ.union([rpcZ.null(), rpcZ.string()]).optional() }).strict().default({}) }).strict();
