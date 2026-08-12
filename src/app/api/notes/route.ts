import { NextRequest } from 'next/server';
import { listNotes, createNote } from '@/lib/db/queries';
import type { CreateNoteInput } from '@/db/types';
import { withCompression } from '@/lib/api/compression';
import { toNoteListDTOs } from '@/lib/api/dto/entity-list';

// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const rows = listNotes({
      areaId: params.get('areaId') ?? undefined,
      taskId: params.get('taskId') ?? undefined,
      status: (params.get('status') as 'active' | 'archived') ?? undefined,
      decisionsOnly: params.get('decisionsOnly') === 'true' ? true : undefined,
      orderBy: params.get('orderBy') ?? undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined,
      offset: params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined,
    });

    // Bodies are 69% of this payload; the list shows a title line and a
    // one-line preview. Full body stays on GET /api/notes/:id.
    return Response.json(toNoteListDTOs(rows));
  } catch (err) {
    console.error('[GET /api/notes]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateNoteInput = await request.json();

    if (typeof body.body !== 'string') {
      return Response.json(
        { error: 'body is required' },
        { status: 400 }
      );
    }

    const row = createNote(body);
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/notes]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
