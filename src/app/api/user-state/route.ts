import { NextRequest } from 'next/server';
import { getUserState, updateUserState } from '@/lib/db/queries';
import { withCompression } from '@/lib/api/compression';
import { isValidInactiveAfterDays, MAX_INACTIVE_AFTER_DAYS } from '@/lib/sessions/inactive';

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
    if ('executionInactiveAfterDays' in body && !isValidInactiveAfterDays(body.executionInactiveAfterDays)) {
      return Response.json(
        { error: `executionInactiveAfterDays must be null (default), 0 (never), or whole days up to ${MAX_INACTIVE_AFTER_DAYS}` },
        { status: 400 },
      );
    }
    const row = updateUserState(body);
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/user-state]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
