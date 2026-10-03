import { revertDeckTo } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Make a prior deck version active again (the escape hatch for "this new deck
 * isn't what I want — give me my earlier one"). Supersedes the current active
 * deck for that day and re-activates the target.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const deck = revertDeckTo(id);
    if (!deck) {
      return reply({ error: 'Deck not found' }, { status: 404 });
    }
    return reply(deck);
  } catch (err) {
    console.error('[POST /api/deck/:id/revert]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
