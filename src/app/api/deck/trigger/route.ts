import { NextRequest } from 'next/server';
import { getMorningDeckConfig, setMorningDeckConfig } from '@/lib/deck/trigger';
import { withCompression } from '@/lib/api/compression';

/** Current morning-refresh cron config (enabled / time / timezone). */
// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET() {
  try {
    return Response.json(getMorningDeckConfig());
  } catch (err) {
    console.error('[GET /api/deck/trigger]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

/** Enable/disable or retime the morning refresh. Body: { enabled?, time? }. */
export async function PUT(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({}));
    const cfg = setMorningDeckConfig({
      enabled: typeof body?.enabled === 'boolean' ? body.enabled : undefined,
      time: typeof body?.time === 'string' ? body.time : undefined,
    });
    return Response.json(cfg);
  } catch (err) {
    console.error('[PUT /api/deck/trigger]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
