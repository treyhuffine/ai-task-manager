import { NextRequest } from 'next/server';
import { getMorningDeckConfig, setMorningDeckConfig } from '@/lib/deck/trigger';

/** Current morning-refresh cron config (enabled / time / timezone). */
export async function GET() {
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
