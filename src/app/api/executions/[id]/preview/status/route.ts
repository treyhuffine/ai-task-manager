/**
 * Cheap preview status snapshot for an execution — no side effects, no
 * bring-up. The pane polls this; `start` is what actually spins things up.
 */

import type { NextRequest } from 'next/server';
import { getPreviewState } from '@/lib/preview/service';
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
    return Response.json(getPreviewState(id, service || null));
  } catch (err) {
    return previewErrorResponse(err, 'GET /api/executions/:id/preview/status');
  }
}
