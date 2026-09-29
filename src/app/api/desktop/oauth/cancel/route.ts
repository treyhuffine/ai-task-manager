import { desktopEnabled, desktopOAuth } from '@/lib/connectors/desktop-oauth';

export async function POST(request: Request) {
  if (!desktopEnabled()) return new Response('Not found', { status: 404 });
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== 'string') return Response.json({ error: 'A connection attempt is required' }, { status: 400 });
  return Response.json({ ok: desktopOAuth().cancel(body.id) });
}
