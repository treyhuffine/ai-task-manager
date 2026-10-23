import { NextRequest } from 'next/server';
import { downloadSessionFile } from '@/lib/sessions/file-download';

/** Authenticated attachment delivery. JSON file reads stay on the shared tRPC operation. */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const requested = request.nextUrl.searchParams.get('path');
    if (!requested) return Response.json({ error: 'Missing path parameter' }, { status: 400 });
    const { id } = await params;
    return await downloadSessionFile(request, id, requested);
  } catch (error) {
    console.error('[GET /api/sessions/:id/download]', error);
    return Response.json({ error: 'This file could not be downloaded.' }, { status: 500 });
  }
}
export const HEAD = GET;
