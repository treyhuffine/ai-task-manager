import { z } from 'zod';
import { readLimitedJson, RequestBodyTooLargeError } from '@/lib/api/limited-body';
import { getRequestKey } from '@/lib/auth/request-key';
import { mcpCallContext } from '@/lib/orchestrator/mcp-caller';
import { dispatchEmailOperation } from '@/lib/orchestrator/email-actions';
import { ActionError } from '@/lib/orchestrator/types';

/** Signed CLI forwarding keeps live draft updates in the server process. No send operation. */
export async function POST(request: Request) {
  const key = getRequestKey(request.headers);
  if (!key || (key.scope !== 'viewer' && key.scope !== 'session')) return Response.json({ error: 'Unauthorized' }, { status: 403 });
  try {
    const body = z.object({ operation: z.enum(['create', 'get', 'update', 'accounts']), input: z.unknown() }).strict().parse(await readLimitedJson(request));
    return Response.json(await dispatchEmailOperation(mcpCallContext(request.headers), body.operation, body.input));
  } catch (error) {
    if (error instanceof RequestBodyTooLargeError) return Response.json({ error: 'Email draft is too large', code: 'invalid_params' }, { status: 413 });
    if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: 'Invalid email draft parameters', code: 'invalid_params' }, { status: 422 });
    if (error instanceof ActionError) return Response.json({ error: error.message, code: error.code }, { status: error.code === 'not_found' ? 404 : error.code === 'conflict' ? 409 : error.code === 'unsupported' ? 403 : 422 });
    return Response.json({ error: 'Email draft is unavailable', code: 'internal_error' }, { status: 500 });
  }
}
