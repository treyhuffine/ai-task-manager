import type { NextRequest } from 'next/server';
import { listBackgroundTaskEvents } from '@/lib/db/queries';
import { toChatEventDTOs } from '@/lib/api/dto/chat-event';

/** Task ids per request. A session rarely has more than a handful live. */
const MAX_IDS = 50;

/**
 * The events behind specific background tasks: each task's lifecycle plus
 * the tool call that launched it and its output. The background-task strip
 * asks for tasks the runtime reports live but that started before the
 * transcript's loaded page, so a long-lived task (a dev server an agent
 * left running) still shows, with its command, output and Stop button.
 *
 * `GET /api/sessions/:id/background-tasks?ids=a,b`
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const ids = (request.nextUrl.searchParams.get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS);
    return Response.json(toChatEventDTOs(listBackgroundTaskEvents(id, ids)));
  } catch (err) {
    console.error('[GET /api/sessions/:id/background-tasks]', err);
    return Response.json({ error: String(err) }, { status: 500 });
  }
}
