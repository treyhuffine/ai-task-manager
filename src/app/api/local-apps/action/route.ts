import { getRequestKey } from '@/lib/auth/request-key';
import { actorFromSessionCredential, sessionCredentialFromHeaders } from '@/lib/orchestrator/session-credential';
import { dispatchAppAction } from '@/lib/local-apps/actions';
import { localAppsEnabled } from '@/lib/local-apps/service';
import { readLimitedJson } from '@/lib/api/limited-body';
export async function POST(request: Request) {
  if (!localAppsEnabled()) return Response.json({ error: 'Local apps unavailable' }, { status: 404 });
  const key = getRequestKey(request.headers);
  if (!key || key.scope === 'worker') return Response.json({ error: 'Unauthorized' }, { status: 403 });
  const actor = key.scope === 'session' ? { sessionId: key.sessionChatId, source: 'ai' as const } : actorFromSessionCredential(sessionCredentialFromHeaders(request.headers));
  try { const body = await readLimitedJson(request, 1024 * 1024) as { operation: string; input: Record<string,unknown> }; const result = await dispatchAppAction({ remote: true, actor, caller: { location: key.location, apiKeyId: key.apiKeyId } }, body.operation, body.input); return Response.json(result); }
  catch (error) { return Response.json({ error: error instanceof Error ? error.message : 'App operation failed' }, { status: 409 }); }
}
