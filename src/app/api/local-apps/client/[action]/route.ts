/**
 * An outside client's call into the local app its key was made for. The proxy
 * lets an `app_client` key reach this route and nothing else. The key's app and
 * the app's declared client actions are checked in `clientCall`.
 */
import { publicError } from '@ri/app-kit/contract';
import { getRequestKey } from '@/lib/auth/request-key';
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { getApiKey } from '@/lib/db/queries';
import { localApps, localAppsEnabled } from '@/lib/local-apps/service';

const STATUS: Record<string, number> = { not_found: 404, forbidden: 403, revoked: 403, invalid_input: 400, busy: 503, timeout: 504 };

export async function POST(request: Request, { params }: { params: Promise<{ action: string }> }) {
  if (!localAppsEnabled()) return Response.json({ error: 'Local apps unavailable' }, { status: 404 });
  const key = getRequestKey(request.headers);
  const instanceId = key?.scope === 'app_client' ? getApiKey(key.apiKeyId)?.client : null;
  if (!instanceId) return Response.json({ error: 'Unauthorized' }, { status: 403 });
  let input: unknown;
  try {
    input = await readLimitedJson(request);
  } catch (error) {
    return error instanceof RequestBodyTooLargeError
      ? Response.json({ error: 'This request is too large' }, { status: 413 })
      : Response.json({ error: 'Send a JSON body' }, { status: 400 });
  }
  try {
    return Response.json(await localApps().clientCall(instanceId, (await params).action, input, request.signal));
  } catch (error) {
    const failure = publicError(error);
    return Response.json({ error: failure.message, code: failure.code }, { status: STATUS[failure.code] ?? 409 });
  }
}
