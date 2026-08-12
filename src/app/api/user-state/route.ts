import { NextRequest } from 'next/server';
import { getUserState, updateUserState } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    const row = getUserState();
    return Response.json(row);
  } catch (err) {
    console.error('[GET /api/user-state]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const row = updateUserState(body);
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/user-state]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
