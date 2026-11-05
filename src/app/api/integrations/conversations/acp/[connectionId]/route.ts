import { z } from 'zod/v4';
import { readLimitedJson } from '@/lib/api/limited-body';
import * as q from '@/lib/db/queries';
import { readConversationSecrets, sameConversationToken } from '@/lib/integrations/conversations/secrets';
import { acceptExternalConversation, authorizedConversationThread, drainConversations } from '@/lib/integrations/conversations/service';

const input = z.discriminatedUnion('operation', [
  z.object({ operation: z.literal('hello') }).strict(),
  z.object({ operation: z.literal('prompt'), channelId: z.uuid(), threadId: z.string().min(1).max(100), eventId: z.string().min(1).max(100), text: z.string().min(1).max(20_000), direct: z.boolean().optional() }).strict(),
  z.object({ operation: z.literal('poll'), threadId: z.string().optional() }).strict(),
  z.object({ operation: z.literal('ack'), outputId: z.string().min(1), part: z.number().int().nonnegative(), complete: z.boolean() }).strict(),
  z.object({ operation: z.literal('cancel'), threadId: z.string().min(1), eventId: z.string().min(1) }).strict(),
]);

export async function POST(request: Request, route: { params: Promise<{ connectionId: string }> }) {
  const { connectionId } = await route.params;
  try {
    const connection = q.getConversationConnection(connectionId);
    const token = request.headers.get('authorization')?.match(/^Bearer ([a-f0-9]{48})$/)?.[1];
    if (!connection?.enabled || connection.provider !== 'buzz' || !token) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const secrets = await readConversationSecrets(connection.id);
    if (!secrets.bridgeToken || !sameConversationToken(token, secrets.bridgeToken)) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = input.parse(await readLimitedJson(request, 128 * 1024));
    if (body.operation === 'hello') return Response.json({ name: connection.name, relay: connection.externalWorkspaceId, team: q.getHome()?.kind === 'team' });
    if (body.operation === 'prompt') {
      const result = acceptExternalConversation({ connectionId, channelId: body.channelId, threadId: body.threadId,
        externalEventId: body.eventId, externalUserId: 'acp-host', content: body.text, mentioned: true, direct: body.direct });
      void drainConversations();
      return Response.json(result);
    }
    if (body.operation === 'cancel') {
      const { thread } = authorizedConversationThread(connectionId, body.threadId);
      const result = acceptExternalConversation({ connectionId, channelId: thread.channelId, threadId: thread.threadId,
        externalEventId: body.eventId, externalUserId: 'acp-host', content: 'stop', mentioned: true, stop: true });
      void drainConversations();
      return Response.json(result);
    }
    if (body.operation === 'ack') {
      const output = q.getConversationOutput(body.outputId);
      if (!output) return Response.json({ error: 'Unknown output' }, { status: 404 });
      authorizedConversationThread(connectionId, output.threadId);
      if (body.part < output.part) return Response.json({ ok: true });
      q.updateConversationOutput(output.id, { part: body.part, ...(body.complete ? { status: 'sent' as const } : {}) });
      return Response.json({ ok: true });
    }
    if (body.threadId) authorizedConversationThread(connectionId, body.threadId);
    const outputs = q.conversationOutputsForConnection(connectionId, body.threadId).map(output => {
      const { thread } = authorizedConversationThread(connectionId, output.threadId);
      return { ...output, channelId: thread.channelId, externalThreadId: thread.threadId };
    });
    const thread = body.threadId ? q.getConversationThread(body.threadId) : null;
    const runtime = thread?.sessionId ? await import('@/lib/executor/adapter') : null;
    return Response.json({ outputs, running: Boolean(thread?.sessionId && (runtime?.isRunning(thread.sessionId) || runtime?.hasBackgroundTasks(thread.sessionId))),
      queued: body.threadId ? q.hasQueuedConversationInputs(body.threadId) : false });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'Conversation unavailable' }, { status: 400 }); }
}
