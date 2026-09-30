import { createHash } from 'node:crypto';
import { beginMcpOAuth, connectMcpClient, finishMcpOAuth } from '@connectors/engine/mcp';
import { ConnectorError, createRedactor, isConnectorError } from '@connectors/engine';
import type { McpServerEntry } from './mcp-servers';
import { isDesktopRequest, desktopOAuth, desktopRelayFor, type DesktopOAuthFlow } from './desktop-oauth';
import { rememberOAuthReturn } from './oauth-return';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { usesRegisteredOAuth } from './hosted-oauth-config';
import { registerMcpSecrets } from './mcp-secrets';
import { finalizeMcpServer } from './mcp-lifecycle';
import { getConnectorRuntime, getMcpServerStore, invalidateConnectorRuntime, mcpOAuthProviderFor, MCP_TIMEOUT_MS, withTimeout } from './runtime';

export async function completeMcpAuthorization(entry: McpServerEntry, code: string, state: string, provider = mcpOAuthProviderFor(entry)) {
  if (!await getMcpServerStore().consumeOAuthState(entry.id, state)) throw new Error('Invalid or expired authorization state');
  // Load the saved redirect URI before the SDK reads its synchronous getter.
  await provider.clientInformation();
  await withTimeout(finishMcpOAuth({ url: entry.url, authProvider: provider, authorizationCode: code }), 30_000, 'finish authorization');
  invalidateConnectorRuntime();
  const runtime = await getConnectorRuntime();
  const saved = getMcpServerStore().get(entry.id);
  const toolkitId = entry.providerId ?? `mcp_${entry.slug}`;
  if (!saved || (saved.enabled && (saved.lastStatus !== 'ok' || !runtime.getToolkits().some((toolkit) => toolkit.id === toolkitId)))) {
    throw new Error('Authorization succeeded, but the connector could not load its tools. Try testing the connection again.');
  }
  if (saved.enabled) {
    const recorded = await finalizeMcpServer(saved, getMcpServerStore(), (current) =>
      getMcpServerStore().completeAuthorization(current.id, authorizationId(state)));
    if (!recorded) throw new Error('The connection changed while authorization finished. Try connecting again.');
  }
}

// The UI can recognize this exact completed consent without receiving the
// saved OAuth state or mistaking old, still-valid tokens for a new connection.
function authorizationId(state: string): string {
  return createHash('sha256').update(state).digest('hex');
}

/** `request` is the browser call that started the add, so the callback can return to its origin. */
export async function beginMcpAuthorization(entry: McpServerEntry, request?: Request, returnTo?: string) {
  let flow: DesktopOAuthFlow | undefined;
  let authUrl: string | undefined;
  const redactor = createRedactor();
  try {
    // Stop the previous session before replacing its authorization state. A
    // concurrent refresh must not overwrite this sign-in's tokens or PKCE data.
    invalidateConnectorRuntime();
    const definition = entry.providerId ? getHostedMcpProvider(entry.providerId) : undefined;
    const registered = usesRegisteredOAuth(definition);
    // Registered applications need the exact stable callback shown in Settings,
    // including when sign-in starts from the desktop app.
    if (!registered && request && isDesktopRequest(request)) flow = await desktopOAuth().begin(`mcp:${entry.id}`, { relayUrl: desktopRelayFor('mcp', true), returnTo });
    const provider = mcpOAuthProviderFor(entry, (url) => { authUrl = url.href; }, {
      redirectUri: flow?.redirectUri, callbackChannel: flow ? 'desktop' : 'web', interactive: true,
      onState: (state) => registerMcpSecrets(redactor, state),
    });
    try {
      // Only a trusted catalog profile can opt into preauthorization. An
      // arbitrary 403 remains an error rather than an authentication signal.
      if (definition?.auth?.kind === 'oauth' && definition.auth.authorizeBeforeConnect) {
        await withTimeout(beginMcpOAuth({ url: entry.url, authProvider: provider,
          ...(definition.auth.scopes?.length ? { scope: definition.auth.scopes.join(' ') } : {}),
        }), MCP_TIMEOUT_MS, 'authorize');
      }
      if (!authUrl) {
        const client = await withTimeout(connectMcpClient({ url: entry.url, name: entry.slug, authProvider: provider }), MCP_TIMEOUT_MS, 'authorize', (lateClient) => lateClient.close());
        await client.close().catch(() => {});
      }
    } catch (error) { if (!authUrl) throw error; }
    if (!authUrl) {
      flow?.cancel();
      invalidateConnectorRuntime();
      return { requiresAuth: false as const };
    }
    const state = new URL(authUrl).searchParams.get('state');
    if (!state) throw new Error('The authorization server did not preserve the sign-in state');
    flow?.arm(state, async (params) => completeMcpAuthorization(entry, params.get('code')!, params.get('state')!, provider));
    if (!flow && request) rememberOAuthReturn(state, request, returnTo);
    return { requiresAuth: true as const, authUrl, authorizationId: authorizationId(state), ...(flow ? { desktopFlowId: flow.id } : {}) };
  } catch (error) {
    flow?.cancel();
    const message = redactor.redact(error instanceof Error ? error.message : String(error));
    // Routes may return this message directly. Rebuild the error so its stack,
    // cause and SDK-specific fields cannot retain unredacted remote responses.
    if (isConnectorError(error)) throw new ConnectorError(error.code, message, {
      status: error.status, retryAfter: error.retryAfter, indeterminate: error.indeterminate,
    });
    throw new Error(message);
  }
}
