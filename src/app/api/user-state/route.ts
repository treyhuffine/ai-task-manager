import { NextRequest } from 'next/server';
import { getUserState, updateUserState } from '@/lib/db/queries';

export async function GET() {
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
    const row = updateUserState(body);
    return Response.json(row);
  } catch (err) {
    console.error('[PATCH /api/user-state]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
