import { getRequestKey } from '@/lib/auth/request-key';
import { actorFromSessionCredential, sessionCredentialFromHeaders } from '@/lib/orchestrator/session-credential';
import { dispatchSourceAction } from '@/lib/chat-sources/actions';
import { readLimitedJson } from '@/lib/api/limited-body';
export async function POST(request: Request) {
  if (process.env.RI_CHAT_SOURCES !== '1') return Response.json({ error: 'App mentions unavailable' }, { status: 404 });
  const key = getRequestKey(request.headers);
  if (!key || key.scope === 'worker') return Response.json({ error: 'Unauthorized' }, { status: 403 });
  const actor = key.scope === 'session' ? { sessionId: key.sessionChatId, source: 'ai' as const } : actorFromSessionCredential(sessionCredentialFromHeaders(request.headers));
  if (!actor?.sessionId) return Response.json({ error: 'A verified chat is required' }, { status: 403 });
  try {
    const body = await readLimitedJson(request, 1024 * 1024) as { operation: string; input: unknown };
    return Response.json(await dispatchSourceAction({ remote: true, actor }, body.operation, body.input, request.signal));
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'App operation failed' }, { status: 409 }); }
}
