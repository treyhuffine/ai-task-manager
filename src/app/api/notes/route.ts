import { NextRequest } from 'next/server';
import { listNotes, createNote } from '@/lib/db/queries';
import type { CreateNoteInput } from '@/db/types';

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;

    const rows = listNotes({
      area_id: params.get('area_id') ?? undefined,
      task_id: params.get('task_id') ?? undefined,
      status: (params.get('status') as 'active' | 'archived') ?? undefined,
      order_by: params.get('order_by') ?? undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined,
      offset: params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined,
    });

    return Response.json(rows);
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
