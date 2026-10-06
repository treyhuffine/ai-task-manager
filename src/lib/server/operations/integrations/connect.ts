import { INTEGRATION_LABELS } from '@/constants/integrations';
import { beginConnect } from '@/lib/integrations/begin-connect';
import { ensureHostedMcpServer, hostedAccountSelection, resolveHostedMcpAccount } from '@/lib/integrations/hosted-mcp';
import { usesRegisteredOAuth } from '@/lib/integrations/hosted-oauth-config';
import { beginMcpAuthorization } from '@/lib/integrations/mcp-authorization';
import { safeReturnPath } from '@/lib/integrations/oauth-return';
import { getIntegrationConnectionStore, getIntegrationOwnerId, getMcpServerStore, invalidateIntegrationRuntime, selectHostedOAuthConfig, withHostedOAuthConfigLock } from '@/lib/integrations/runtime';
import { reply, type OperationContext } from '@/lib/server/operation';
import { isAuthConfigRequiredError, isIntegrationError } from '@integrations/engine';
import { getHostedMcpProvider } from '@integrations/engine/providers';
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
  // callback falls back to the integrations settings pane.
  const returnTo = safeReturnPath(body.returnTo);
  try {
    const hosted = getHostedMcpProvider(providerId);
    if (hosted) {
      if (hosted.auth && hosted.auth.kind !== 'oauth') {
        return reply({ error: hosted.auth.kind === 'bearer' ? `This ${INTEGRATION_LABELS.singular.toLowerCase()} uses a connection token. Connect it from Settings.` : `This ${INTEGRATION_LABELS.singular.toLowerCase()} does not use browser sign-in. Connect it from Settings.` }, { status: 400 });
      }
      const selection = hostedAccountSelection(body);
      const existing = await resolveHostedMcpAccount(hosted, getMcpServerStore(), getIntegrationConnectionStore(), getIntegrationOwnerId(), selection);
      const selectedId = typeof body.authConfigId === 'string' ? body.authConfigId : existing?.authConfigId;
      if (existing?.authConfigId && selectedId !== existing.authConfigId) throw new Error(`Disconnect this ${INTEGRATION_LABELS.singular.toLowerCase()} before changing its OAuth app.`);
      const registered = usesRegisteredOAuth(hosted);
      const selected = registered ? await selectHostedOAuthConfig(providerId, selectedId) : undefined;
      const create = async () => {
        // Resolve again under the same lock used by app deletion.
        if (selected) await selectHostedOAuthConfig(providerId, selected.config.id);
        return ensureHostedMcpServer(hosted, getMcpServerStore(), getIntegrationConnectionStore(), getIntegrationOwnerId(), {
          ...selection,
          endpointId: body.endpointId, instanceUrl: body.instanceUrl,
          ...(selected ? { authConfigId: selected.config.id } : {}),
        });
      };
      const entry = selected ? await withHostedOAuthConfigLock(selected.config.id, create) : await create();
      const result = await beginMcpAuthorization(entry, request, returnTo ?? undefined);
      invalidateIntegrationRuntime();
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
    const code = isIntegrationError(e) ? e.code : undefined;
    return reply({ error: code ?? (e instanceof Error ? e.message : String(e)) }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "providerId": rpcZ.string().optional(), "scopes": rpcZ.array(rpcZ.string()).optional(), "label": rpcZ.string().nullable().optional(), "existingConnectionId": rpcZ.string().optional(), "authConfigId": rpcZ.string().optional(), "returnTo": rpcZ.string().optional(), "endpointId": rpcZ.string().optional(), "instanceUrl": rpcZ.string().optional(), "serverId": rpcZ.string().optional(), "addAccount": rpcZ.boolean().optional(), "setupId": rpcZ.string().optional() }).strict().default({}) }).strict();
