import type { NextRequest } from 'next/server';
import { listNeedsReviewSessionCandidates } from '@/lib/db/queries';

/**
 * Returns the *candidate* set — sessions where lastOutcomeEventAt has
 * advanced past lastViewedAt. The client filters out any session id in
 * its runtime streaming map; that map only exists in the browser, so the
 * server can't subtract it for us.
 */
export async function GET(_request: NextRequest) {
  try {
    const rows = listNeedsReviewSessionCandidates();
    return Response.json(rows);
  } catch (err) {
    console.error('[GET /api/sessions/needs-review]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
