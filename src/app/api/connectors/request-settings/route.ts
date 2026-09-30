import { NextRequest, NextResponse } from 'next/server';
import { connectorRequestsEnabled, setConnectorRequestsEnabled } from '@/lib/connectors/request-settings';
import { SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';

/**
 * Whether agents may ask to connect accounts from chat (Settings, Plugins). Off removes the
 * `request_connection` tool from sessions started afterwards. Reconnect cards for a connection
 * that stopped working show either way, since they come from a failed call, not an agent's ask.
 */
export async function GET() {
  return NextResponse.json({ requestsEnabled: connectorRequestsEnabled() });
}

export async function PATCH(request: NextRequest) {
  if (request.headers.get(SESSION_CREDENTIAL_HEADER)) {
    return NextResponse.json({ error: 'This setting is the user’s to change.' }, { status: 403 });
  }
  const body = (await request.json().catch(() => ({}))) as { requestsEnabled?: unknown };
  if (typeof body.requestsEnabled !== 'boolean') {
    return NextResponse.json({ error: 'requestsEnabled must be true or false' }, { status: 400 });
  }
  setConnectorRequestsEnabled(body.requestsEnabled);
  return NextResponse.json({ requestsEnabled: connectorRequestsEnabled() });
}
