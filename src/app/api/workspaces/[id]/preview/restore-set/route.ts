/**
 * Restore-set (§4): bring up a workspace's pinned previews at once, reading
 * from the §2 desired-state. Returns a per-target outcome summary.
 */

import type { NextRequest } from 'next/server';
import { restoreWorkspacePreviews } from '@/lib/preview/service';
import { previewErrorResponse } from '@/lib/preview/route-helpers';

export const runtime = 'nodejs';

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const results = await restoreWorkspacePreviews(id);
    return Response.json({ results });
  } catch (err) {
    return previewErrorResponse(err, 'POST /api/workspaces/:id/preview/restore-set');
  }
}
