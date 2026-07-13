import { startManualSweep } from '@/lib/stream-triage/sweep';
import { triageErrorResponse } from '@/lib/stream-triage/http';

/** POST /api/stream/triage — the Triage button: dispatch a sweep session
 *  immediately instead of waiting for the scheduler tick. */
export async function POST() {
  try {
    const result = await startManualSweep();
    if (!result.started) {
      const status = result.reason === 'already_running' ? 409 : result.reason === 'empty' ? 200 : 500;
      return Response.json(result, { status });
    }
    return Response.json(result, { status: 202 });
  } catch (err) {
    return triageErrorResponse('POST /api/stream/triage', err);
  }
}
