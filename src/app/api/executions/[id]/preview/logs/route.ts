/**
 * Cursor-based log tail for a preview's supervised dev server. Each fetch
 * asks for everything since `seq N`; the client accumulates.
 */

import type { NextRequest } from 'next/server';
import { previewLogs } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';
import { withCompression } from '@/lib/api/compression';

export const runtime = 'nodejs';

// Compressed when the body is JSON and over ~1KiB; a streamed or
// non-JSON response passes through untouched. See lib/api/compression.ts.
export const GET = withCompression(handleGET);

async function handleGET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const service = request.nextUrl.searchParams.get('service');
    const cursor = Number(request.nextUrl.searchParams.get('cursor') ?? '0') || 0;
    return Response.json(previewLogs(id, service || null, cursor));
  } catch (err) {
    return previewErrorResponse(err, 'GET /api/executions/:id/preview/logs');
  }
}
