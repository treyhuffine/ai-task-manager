import {
  DECK_INSTRUCTIONS_MAX_BYTES,
  readDeckInstructions,
  writeDeckInstructions,
} from '@/lib/deck/instructions';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** The user's DECK.md source instructions. */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.

export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    return reply({ content: readDeckInstructions() ?? '' });
  } catch (err) {
    console.error('[GET /api/deck/instructions]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

/** Save the user's DECK.md. Body: { content: string }. */
export async function PUT(rpcInput: rpcZ.infer<typeof PUTInput>, _request: OperationContext) {
  try {
    const body = rpcInput.body;
    const content = body?.content;
    if (typeof content !== 'string') {
      return reply({ error: 'content must be a string' }, { status: 400 });
    }
    if (Buffer.byteLength(content, 'utf8') > DECK_INSTRUCTIONS_MAX_BYTES) {
      return reply({ error: 'content too large' }, { status: 413 });
    }
    writeDeckInstructions(content);
    return reply({ ok: true, content: readDeckInstructions() ?? '' });
  } catch (err) {
    console.error('[PUT /api/deck/instructions]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PUTInput = rpcZ.object({ body: rpcZ.object({ "content": rpcZ.string() }).strict() }).strict();
