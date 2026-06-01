/**
 * Stop a preview: tear down the supervised dev server and close the remote
 * tunnel (if any). The desired-state row survives, so the name/URL stays
 * reserved for a later cold-start.
 */

import type { NextRequest } from 'next/server';
import { stopPreview, getPreviewState } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { service?: string | null };
    const service = body.service ?? null;
    await stopPreview(id, service);
    return Response.json(getPreviewState(id, service));
  } catch (err) {
    return previewErrorResponse(err, 'POST /api/executions/:id/preview/stop');
  }
}
