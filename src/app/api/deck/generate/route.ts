import { NextRequest } from 'next/server';
import { deckGenerationContextSchema } from '@/lib/ai/deck-generation';
import { generateDeck } from '@/lib/ai/generate-deck';
import { ensureCalendarProvider } from '@/lib/deck/calendar-connector';

export const maxDuration = 60;

/**
 * Thin HTTP wrapper over the deck generation pipeline. The pipeline
 * itself lives in `src/lib/ai/generate-deck.ts` so the orchestrator
 * `regenerate_deck` action (CLI + MCP) can call it without HTTP.
 */
export async function POST(request: NextRequest) {
  try {
    ensureCalendarProvider();
    const body = await request.json();
    const generationContext = deckGenerationContextSchema.parse(body);
    const deck = await generateDeck(generationContext);
    return Response.json(deck);
  } catch (err) {
    console.error('[POST /api/deck/generate]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
