import { beginConnect } from '@/lib/connectors/begin-connect';
import { ensureHostedMcpServer, hostedAccountSelection, resolveHostedMcpAccount } from '@/lib/connectors/hosted-mcp';
import { usesRegisteredOAuth } from '@/lib/connectors/hosted-oauth-config';
import { beginMcpAuthorization } from '@/lib/connectors/mcp-authorization';
import { safeReturnPath } from '@/lib/connectors/oauth-return';
import { getConnectorConnectionStore, getConnectorOwnerId, getMcpServerStore, invalidateConnectorRuntime, selectHostedOAuthConfig, withHostedOAuthConfigLock } from '@/lib/connectors/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isAuthConfigRequiredError, isConnectorError } from '@connectors/engine';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { z as rpcZ } from 'zod/v4';

/**
 * Start an OAuth connect for a provider. Returns the provider authorization URL; the client
 * navigates the browser to it. (We return the URL via an authed fetch rather than 302-ing here,
 * so only the *callback* needs to be a public path.)
 */
export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  const body = (rpcInput.body) as {
    providerId?: unknown;
    scopes?: unknown;
    label?: unknown;
    existingConnectionId?: unknown;
    authConfigId?: unknown;
    returnTo?: unknown;
    endpointId?: unknown;
    instanceUrl?: unknown;
    serverId?: unknown;
    addAccount?: unknown;
    setupId?: unknown;
  };
  const providerId = typeof body.providerId === 'string' ? body.providerId : 'google';
  // Where the OAuth callback should land the browser afterwards. Same-origin
  // paths only (single leading slash). Anything else is ignored, and the
  // callback falls back to the connectors settings pane.
  const returnTo = safeReturnPath(body.returnTo);
  try {
    const hosted = getHostedMcpProvider(providerId);
    if (hosted) {
      if (hosted.auth && hosted.auth.kind !== 'oauth') {
        return reply({ error: hosted.auth.kind === 'bearer' ? 'This connector uses a connection token. Connect it from Settings.' : 'This connector does not use browser sign-in. Connect it from Settings.' }, { status: 400 });
      }
      const selection = hostedAccountSelection(body);
      const existing = await resolveHostedMcpAccount(hosted, getMcpServerStore(), getConnectorConnectionStore(), getConnectorOwnerId(), selection);
      const selectedId = typeof body.authConfigId === 'string' ? body.authConfigId : existing?.authConfigId;
      if (existing?.authConfigId && selectedId !== existing.authConfigId) throw new Error('Disconnect this connector before changing its OAuth app.');
      const registered = usesRegisteredOAuth(hosted);
      const selected = registered ? await selectHostedOAuthConfig(providerId, selectedId) : undefined;
      const create = async () => {
        // Resolve again under the same lock used by app deletion.
        if (selected) await selectHostedOAuthConfig(providerId, selected.config.id);
        return ensureHostedMcpServer(hosted, getMcpServerStore(), getConnectorConnectionStore(), getConnectorOwnerId(), {
          ...selection,
          endpointId: body.endpointId, instanceUrl: body.instanceUrl,
          ...(selected ? { authConfigId: selected.config.id } : {}),
        });
      };
      const entry = selected ? await withHostedOAuthConfigLock(selected.config.id, create) : await create();
      const result = await beginMcpAuthorization(entry, request, returnTo ?? undefined);
      invalidateConnectorRuntime();
      return reply({ ...result, serverId: entry.id, ...('authUrl' in result ? { authorizationUrl: result.authUrl } : {}) });
    }
    const result = await beginConnect(request, {
      providerId,
      scopes: Array.isArray(body.scopes) ? (body.scopes as string[]) : undefined,
      label: typeof body.label === 'string' ? body.label : undefined,
      existingConnectionId: typeof body.existingConnectionId === 'string' ? body.existingConnectionId : undefined,
      authConfigId: typeof body.authConfigId === 'string' ? body.authConfigId : undefined,
      returnTo,
    });
    return reply(result);
  } catch (e) {
    // A multi-client provider with no resolvable default surfaces a picker — relay the choices.
    if (isAuthConfigRequiredError(e)) {
      return reply({ error: 'auth_config_required', choices: e.choices }, { status: 409 });
    }
    const code = isConnectorError(e) ? e.code : undefined;
    return reply({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "providerId": rpcZ.string().optional(), "scopes": rpcZ.array(rpcZ.string()).optional(), "label": rpcZ.string().nullable().optional(), "existingConnectionId": rpcZ.string().optional(), "authConfigId": rpcZ.string().optional(), "returnTo": rpcZ.string().optional(), "endpointId": rpcZ.string().optional(), "instanceUrl": rpcZ.string().optional(), "serverId": rpcZ.string().optional(), "addAccount": rpcZ.boolean().optional(), "setupId": rpcZ.string().optional() }).strict().default({}) }).strict();
