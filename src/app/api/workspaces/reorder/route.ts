import type { NextRequest } from 'next/server';
import { reorderWorkspaces } from '@/lib/db/queries';

export async function POST(request: NextRequest) {
  try {
    const body: { ids?: unknown } = await request.json();
    if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === 'string')) {
      return Response.json({ error: 'ids must be an array of strings' }, { status: 400 });
    }
    reorderWorkspaces(body.ids as string[]);
    return Response.json({ ok: true });
  } catch (err) {
    console.error('[POST /api/workspaces/reorder]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
