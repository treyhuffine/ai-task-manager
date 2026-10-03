import { toChatEventDTOs } from '@/lib/api/dto/chat-event';
import { listBackgroundTaskEvents } from '@/lib/db/queries';
import { reply, searchParams, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

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
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const ids = (searchParams(rpcInput.query).get('ids') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, MAX_IDS);
    return reply(toChatEventDTOs(listBackgroundTaskEvents(id, ids)));
  } catch (err) {
    console.error('[GET /api/sessions/:id/background-tasks]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), query: rpcZ.object({ "ids": rpcZ.string().optional() }).strict().optional() }).strict();
