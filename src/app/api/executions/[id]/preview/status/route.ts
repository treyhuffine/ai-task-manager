/**
 * Cheap preview status snapshot for an execution — no side effects, no
 * bring-up. The pane polls this; `start` is what actually spins things up.
 */

import type { NextRequest } from 'next/server';
import { getPreviewState } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';

export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const service = request.nextUrl.searchParams.get('service');
    return Response.json(getPreviewState(id, service || null));
  } catch (err) {
    return previewErrorResponse(err, 'GET /api/executions/:id/preview/status');
  }
}
