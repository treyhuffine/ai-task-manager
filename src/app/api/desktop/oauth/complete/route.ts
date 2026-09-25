import { callbackParams, desktopEnabled, desktopOAuth } from '@/lib/connectors/desktop-oauth';

export async function POST(request: Request) {
  if (!desktopEnabled()) return new Response('Not found', { status: 404 });
  try {
    const text = await request.text();
    if (text.length > 16_384) return Response.json({ error: 'Invalid callback' }, { status: 400 });
    const ok = await desktopOAuth().complete(callbackParams(new URLSearchParams(text)));
    return Response.json({ ok }, { status: ok ? 200 : 400 });
  } catch { return Response.json({ error: 'Invalid callback' }, { status: 400 }); }
}
