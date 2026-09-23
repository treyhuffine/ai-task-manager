import type { NextRequest } from 'next/server';
import { resumeMainChat } from '@/lib/sessions/main-chat';

/**
 * Make a past main chat of the app the current one. The current one is
 * retired, and the harness picks the resumed conversation back up from its
 * persisted session on the next send. See `resumeMainChat`.
 */
export async function POST(request: NextRequest) {
  try {
    const { sessionId } = (await request.json().catch(() => ({}))) as { sessionId?: unknown };
    if (typeof sessionId !== 'string' || !sessionId) {
      return Response.json({ error: 'sessionId is required' }, { status: 400 });
    }
    const result = await resumeMainChat(null, sessionId);
    if (!result.ok) return Response.json({ error: result.error }, { status: result.status });
    return Response.json({ session: result.session });
  } catch (err) {
    console.error('[POST /api/orchestrator-chat/resume]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
