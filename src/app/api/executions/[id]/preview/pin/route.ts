/**
 * Pin / unpin a preview for eager bring-up (the restore-set). Pinned
 * previews are kept warm (skipped by idle-evict) and brought up together by
 * the per-workspace restore-set action.
 */

import type { NextRequest } from 'next/server';
import { setPreviewPinned, getPreviewState } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';

export const runtime = 'nodejs';

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as { pinned?: boolean; service?: string | null };
    const service = body.service ?? null;
    setPreviewPinned(id, service, body.pinned ?? false);
    return Response.json(getPreviewState(id, service));
  } catch (err) {
    return previewErrorResponse(err, 'POST /api/executions/:id/preview/pin');
  }
}
