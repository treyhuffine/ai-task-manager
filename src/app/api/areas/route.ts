import { NextRequest } from 'next/server';
import { listAreas, createArea } from '@/lib/db/queries';
import type { CreateAreaInput } from '@/db/types';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const status = (params.get('status') ?? 'active') as 'active' | 'inactive' | 'archived' | 'all';

    const rows = listAreas({ status });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/areas]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateAreaInput = await request.json();

    if (!body.name) {
      return Response.json({ error: 'name is required' }, { status: 400 });
    }

    const row = createArea(body);
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/areas]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
