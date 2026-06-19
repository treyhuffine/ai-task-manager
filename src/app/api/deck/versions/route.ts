import { NextRequest } from 'next/server';
import { getDeckVersions } from '@/lib/db/queries';
import { todayLocalDate } from '@/lib/deck/date';

/**
 * All deck versions produced for a day (oldest → newest). Drives the
 * "revert to an earlier deck" control. Defaults to today.
 */
export async function GET(request: NextRequest) {
  try {
    const date = request.nextUrl.searchParams.get('date') ?? todayLocalDate();
    return Response.json(getDeckVersions(date));
  } catch (err) {
    console.error('[GET /api/deck/versions]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
