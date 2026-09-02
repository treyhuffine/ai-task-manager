import type { NextRequest } from 'next/server';
import { getTaskStatusCounts } from '@/lib/db/queries';

/** Count of tasks by canonical status (optionally within `?areaId=`), for the
 * lane count badges. */
export async function GET(request: NextRequest) {
  try {
    const areaId = request.nextUrl.searchParams.get('areaId');
    return Response.json(getTaskStatusCounts({ areaId: areaId || undefined }));
  } catch (err) {
    console.error('[GET /api/tasks/counts]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
