import { NextRequest, NextResponse } from 'next/server';
import { isAuthConfigRequiredError, isConnectorError } from '@connectors/engine';
import {
  ConnectionRequestError,
  allowCardForAgent,
  connectCardWithKey,
  declineCard,
  startCardSignIn,
} from '@/lib/connectors/connection-requests';
import { safeReturnPath } from '@/lib/connectors/oauth-return';
import { SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';

/**
 * The user's answer on a Connect card in chat (lib/connectors/connection-requests.ts).
 *
 * Body: `{ action: 'sign_in' | 'key' | 'allow' | 'decline', fields?, returnTo? }`.
 *   - `sign_in` starts the provider sign-in (connect, reconnect, or more access) and returns its
 *     URL, or `{ done: true }` when the account turned out to be connected already;
 *   - `key` connects an API-key provider with the fields typed into the card. They go straight to
 *     the encrypted store, never into the chat or to the agent;
 *   - `allow` gives the card's agent access to exactly the connected accounts checked on the card
 *     (`accounts`: account ids);
 *   - `decline` is "Not now".
 * Each records the answer in the chat and wakes the asking agent.
 *
 * Human-only, like the approval route: no tool reaches it, a request carrying an agent's session
 * credential is refused, and the proxy keeps session tokens to their own MCP servers.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ eventId: string }> }) {
  if (request.headers.get(SESSION_CREDENTIAL_HEADER)) {
    return NextResponse.json({ error: 'Connection requests are answered by the user, not by an agent.' }, { status: 403 });
  }
  const { eventId } = await params;
  const body = (await request.json().catch(() => ({}))) as { action?: unknown; fields?: unknown; returnTo?: unknown; accounts?: unknown };
  try {
    switch (body.action) {
      case 'sign_in':
        return NextResponse.json(await startCardSignIn(request, eventId, safeReturnPath(body.returnTo)));
      case 'key': {
        const fields = body.fields && typeof body.fields === 'object' ? (body.fields as Record<string, unknown>) : {};
        const clean = Object.fromEntries(
          Object.entries(fields).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim() !== ''),
        );
        if (Object.keys(clean).length === 0) return NextResponse.json({ error: 'Enter the key first.' }, { status: 400 });
        await connectCardWithKey(eventId, clean);
        return NextResponse.json({ done: true });
      }
      case 'allow': {
        // Exactly the accounts the user checked (account ids). Omitted only when there was one.
        const accounts = Array.isArray(body.accounts) ? body.accounts.filter((a): a is string => typeof a === 'string') : [];
        await allowCardForAgent(eventId, accounts);
        return NextResponse.json({ done: true });
      }
      case 'decline':
        await declineCard(eventId);
        return NextResponse.json({ done: true });
      default:
        return NextResponse.json({ error: "action must be 'sign_in', 'key', 'allow' or 'decline'" }, { status: 400 });
    }
  } catch (e) {
    if (e instanceof ConnectionRequestError) {
      const status = e.code === 'not_found' ? 404 : e.code === 'already_answered' ? 409 : 400;
      return NextResponse.json({ error: e.message, code: e.code }, { status });
    }
    if (isAuthConfigRequiredError(e)) {
      return NextResponse.json({ error: 'Choose which sign-in app to use in Settings, Plugins.', code: 'auth_config_required' }, { status: 409 });
    }
    const code = isConnectorError(e) ? e.code : undefined;
    return NextResponse.json({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}
