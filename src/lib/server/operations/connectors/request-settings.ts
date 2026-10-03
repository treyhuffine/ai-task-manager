import { connectorRequestsEnabled, setConnectorRequestsEnabled } from '@/lib/connectors/request-settings';
import { SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/**
 * Whether agents may ask to connect accounts from chat (Settings, Plugins). Off removes the
 * `request_connection` tool from sessions started afterwards. Reconnect cards for a connection
 * that stopped working show either way, since they come from a failed call, not an agent's ask.
 */
export async function GET(_rpcInput: rpcZ.infer<typeof GETInput>, _request: OperationContext) {
  return reply({ requestsEnabled: connectorRequestsEnabled() });
}

export async function PATCH(rpcInput: rpcZ.infer<typeof PATCHInput>, request: OperationContext) {
  if (request.headers.get(SESSION_CREDENTIAL_HEADER)) {
    return reply({ error: 'This setting is the user’s to change.' }, { status: 403 });
  }
  const body = (rpcInput.body) as { requestsEnabled?: unknown };
  if (typeof body.requestsEnabled !== 'boolean') {
    return reply({ error: 'requestsEnabled must be true or false' }, { status: 400 });
  }
  setConnectorRequestsEnabled(body.requestsEnabled);
  return reply({ requestsEnabled: connectorRequestsEnabled() });
}

export const GETInput = rpcZ.object({}).strict().default({});
export const PATCHInput = rpcZ.object({ body: rpcZ.object({ "requestsEnabled": rpcZ.boolean().optional() }).strict().default({}) }).strict();
