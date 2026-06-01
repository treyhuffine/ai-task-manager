/**
 * Cursor-based log tail for a preview's supervised dev server. Each fetch
 * asks for everything since `seq N`; the client accumulates.
 */

import type { NextRequest } from 'next/server';
import { previewLogs } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';

export const runtime = 'nodejs';

export async function GET(
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
