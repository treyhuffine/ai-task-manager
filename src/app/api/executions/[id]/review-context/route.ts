import type { NextRequest } from 'next/server';
import { getExecutionReviewContext } from '@/lib/db/queries';

/** What the review affordance needs for an execution (latest output event to
 * disposition, current disposition, the single owning task if any). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return Response.json(getExecutionReviewContext(id));
  } catch (err) {
    console.error('[GET /api/executions/:id/review-context]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
