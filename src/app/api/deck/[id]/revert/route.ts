import { NextRequest } from 'next/server';
import { revertDeckTo } from '@/lib/db/queries';

/**
 * Make a prior deck version active again (the escape hatch for "this new deck
 * isn't what I want — give me my earlier one"). Supersedes the current active
 * deck for that day and re-activates the target.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const deck = revertDeckTo(id);
    if (!deck) {
      return Response.json({ error: 'Deck not found' }, { status: 404 });
    }
    return Response.json(deck);
  } catch (err) {
    console.error('[POST /api/deck/:id/revert]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
