import type { NextRequest } from 'next/server';
import { pickFolder } from '@/lib/fs/native-picker';

/**
 * Spawn a native folder dialog. Blocks until the user picks or cancels —
 * fine for a local-first desktop app, never long-running enough to need
 * special async plumbing.
 */
export async function POST(request: NextRequest) {
  try {
    const body: { prompt?: string } = await request.json().catch(() => ({}));
    const result = await pickFolder(body.prompt);

    if ('path' in result) {
      return Response.json({ path: result.path });
    }
    if ('cancelled' in result) {
      return new Response(null, { status: 204 });
    }
    return Response.json({ error: result.reason }, { status: 501 });
  } catch (err) {
    console.error('[POST /api/fs/pick-folder]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
