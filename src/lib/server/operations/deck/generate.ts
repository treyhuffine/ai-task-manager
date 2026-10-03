import { deckGenerationContextSchema } from '@/lib/ai/deck-generation';
import { generateDeck } from '@/lib/ai/generate-deck';
import { ensureCalendarProvider } from '@/lib/deck/calendar-connector';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Thin HTTP wrapper over the deck generation pipeline. The pipeline
 * itself lives in `src/lib/ai/generate-deck.ts` so the orchestrator
 * `regenerate_deck` action (CLI + MCP) can call it without HTTP.
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    ensureCalendarProvider();
    const body = rpcInput.body;
    const generationContext = deckGenerationContextSchema.parse(body);
    const deck = await generateDeck(generationContext);
    return reply(deck);
  } catch (err) {
    console.error('[POST /api/deck/generate]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "availableMinutes": rpcZ.number().finite().optional(), "context": rpcZ.string().optional(), "contextTags": rpcZ.array(rpcZ.string()).optional() }).strict().default({}) }).strict();
