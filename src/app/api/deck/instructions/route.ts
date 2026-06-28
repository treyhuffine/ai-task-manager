import { NextRequest } from 'next/server';
import {
  readDeckInstructions,
  writeDeckInstructions,
  DECK_INSTRUCTIONS_MAX_BYTES,
} from '@/lib/deck/instructions';

/** The user's DECK.md source instructions. */
export async function GET() {
  try {
    return Response.json({ content: readDeckInstructions() ?? '' });
  } catch (err) {
    console.error('[GET /api/deck/instructions]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** Save the user's DECK.md. Body: { content: string }. */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const content = body?.content;
    if (typeof content !== 'string') {
      return Response.json({ error: 'content must be a string' }, { status: 400 });
    }
    if (Buffer.byteLength(content, 'utf8') > DECK_INSTRUCTIONS_MAX_BYTES) {
      return Response.json({ error: 'content too large' }, { status: 413 });
    }
    writeDeckInstructions(content);
    return Response.json({ ok: true, content: readDeckInstructions() ?? '' });
  } catch (err) {
    console.error('[PUT /api/deck/instructions]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
