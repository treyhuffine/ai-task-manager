import type { NextRequest } from 'next/server';
import { takeOverImportedSession } from '@/lib/import/external-agents';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Flip an imported chat from read-only mirror to live, pointing it at the
 * provider session it was imported from so the next send resumes that thread
 * instead of forking a blank one.
 *
 * User-initiated by design. The composer stays disabled until this runs,
 * because resuming a session the user may still have open in a terminal puts
 * two writers on one transcript, and that is a decision to make knowingly
 * rather than discover afterwards.
 */
export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    return Response.json({ ok: true, ...takeOverImportedSession(id) });
  } catch (err) {
    console.error('[POST /api/sessions/:id/take-over-import]', err);
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
