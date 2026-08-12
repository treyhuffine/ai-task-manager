import { NextRequest } from 'next/server';
import type { CreateStreamInput, StreamStatus } from '@/db/types';
import { createStream, listStreamWithOutcomes } from '@/lib/db/queries';
import { onStreamCaptured } from '@/lib/stream-triage/triggers';
import { withCompression } from '@/lib/api/compression';

// Compressed: this route can ship hundreds of KB of JSON, and Next 16
// does not compress route handlers. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const status = params.get('status');
    const rows = listStreamWithOutcomes({
      status: status ? (status.split(',') as StreamStatus[]) : undefined,
      limit: params.get('limit') ? parseInt(params.get('limit')!, 10) : undefined,
      offset: params.get('offset') ? parseInt(params.get('offset')!, 10) : undefined,
    });
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/stream]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body: CreateStreamInput = await request.json();

    if (!body.rawText) {
      return Response.json({ error: 'rawText is required' }, { status: 400 });
    }

    const row = createStream(body);
    onStreamCaptured(row.id);
    return Response.json(row, { status: 201 });
  } catch (err) {
    console.error('[POST /api/stream]', err);
    return Response.json({ error: String(err) }, { status: 400 });
  }
}
