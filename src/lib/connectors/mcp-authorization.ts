import { connectMcpClient, finishMcpOAuth } from '@connectors/engine/mcp';
import type { McpServerEntry } from './mcp-servers';
import { desktopEnabled, desktopOAuth, desktopRelayFor, type DesktopOAuthFlow } from './desktop-oauth';
import { getConnectorRuntime, getMcpServerStore, invalidateConnectorRuntime, mcpOAuthProviderFor, MCP_TIMEOUT_MS, withTimeout } from './runtime';

export async function completeMcpAuthorization(entry: McpServerEntry, code: string, state: string, provider = mcpOAuthProviderFor(entry)) {
  if (!await getMcpServerStore().consumeOAuthState(entry.id, state)) throw new Error('Invalid or expired authorization state');
  // Load the saved redirect URI before the SDK reads its synchronous getter.
  await provider.clientInformation();
  await withTimeout(finishMcpOAuth({ url: entry.url, authProvider: provider, authorizationCode: code }), 30_000, 'finish authorization');
  invalidateConnectorRuntime();
  await getConnectorRuntime();
}

export async function beginMcpAuthorization(entry: McpServerEntry) {
  let flow: DesktopOAuthFlow | undefined;
  let authUrl: string | undefined;
  try {
    if (desktopEnabled()) flow = await desktopOAuth().begin(`mcp:${entry.id}`, { relayUrl: desktopRelayFor('mcp', true) });
    const provider = mcpOAuthProviderFor(entry, (url) => { authUrl = url.href; }, { redirectUri: flow?.redirectUri, interactive: true });
    try {
      const client = await withTimeout(connectMcpClient({ url: entry.url, name: entry.slug, authProvider: provider }), MCP_TIMEOUT_MS, 'authorize');
      await client.close().catch(() => {});
    } catch (error) { if (!authUrl) throw error; }
    if (!authUrl) {
      flow?.cancel();
      invalidateConnectorRuntime();
      return { requiresAuth: false as const };
    }
    const state = new URL(authUrl).searchParams.get('state');
    if (!state) throw new Error('The authorization server did not preserve the sign-in state');
    flow?.arm(state, async (params) => completeMcpAuthorization(entry, params.get('code')!, params.get('state')!, provider));
    return { requiresAuth: true as const, authUrl, ...(flow ? { desktopFlowId: flow.id } : {}) };
  } catch (error) { flow?.cancel(); throw error; }
}
