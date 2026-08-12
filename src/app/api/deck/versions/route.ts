import { NextRequest } from 'next/server';
import { getDeckVersions } from '@/lib/db/queries';
import { todayLocalDate } from '@/lib/deck/date';
import { withCompression } from '@/lib/api/compression';

/**
 * All deck versions produced for a day (oldest → newest). Drives the
 * "revert to an earlier deck" control. Defaults to today.
 */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') ?? todayLocalDate();
    return Response.json(getDeckVersions(date));
  } catch (err) {
    console.error('[GET /api/deck/versions]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
