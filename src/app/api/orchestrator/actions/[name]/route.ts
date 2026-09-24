/**
 * POST /api/orchestrator/actions/:name: run one orchestrator action.
 *
 * The JSON twin of `ri agent <name>` for computers connected to this home
 * (docs/homes-spec.md §5.3: "Connected-device CLI actions use the home API
 * and preserve the caller's signed session identity"). The body is the
 * action's params. The response is always the same envelope the CLI and the
 * MCP produce, `{ ok, action, result | error }`, with HTTP 200, so a caller
 * renders it the same way whichever transport ran it.
 *
 * Provenance comes from credentials only. The proxy says which key called.
 * A harness session the home started carries its signed session credential
 * in `x-ri-session`, which names the chat. Nothing in the body can claim
 * either. Calls run as untrusted remote calls, so actions that need the
 * trusted local CLI refuse them the way they refuse MCP.
 */

import type { NextRequest } from 'next/server';
import { runAction } from '@/lib/orchestrator/dispatch';
import { actorFromSessionCredential, sessionCredentialFromHeaders } from '@/lib/orchestrator/session-credential';
import { getRequestKey, isOnHomeMachine } from '@/lib/auth/request-key';

export const runtime = 'nodejs';

const MAX_BODY_BYTES = 4 * 1024 * 1024;

export async function POST(request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const key = getRequestKey(request.headers);

  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return Response.json({ error: 'payload_too_large', message: 'Action params are limited to 4 MiB.' }, { status: 413 });
  }
  let input: unknown = {};
  if (text.trim()) {
    try {
      input = JSON.parse(text);
    } catch {
      return Response.json({ error: 'invalid_json', message: 'The body must be JSON params for the action.' }, { status: 400 });
    }
  }

  const actor = actorFromSessionCredential(sessionCredentialFromHeaders(request.headers));
  const envelope = await runAction(name, input, {
    remote: true,
    actor,
    caller: { location: isOnHomeMachine(key) ? 'home' : 'elsewhere', apiKeyId: key?.apiKeyId ?? null },
  });
  return Response.json(envelope);
}
