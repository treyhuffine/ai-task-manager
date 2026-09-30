import type { Redactor } from '@connectors/engine';
import type { McpOAuthState } from './mcp-oauth';

/** Register secrets before SDK errors or remote responses can reflect them. */
export function registerMcpSecrets(redactor: Redactor, state: McpOAuthState): void {
  if (state.tokens?.access_token) redactor.register(state.tokens.access_token, 'access_token');
  if (state.tokens?.refresh_token) redactor.register(state.tokens.refresh_token, 'refresh_token');
  const info = state.clientInformation;
  if (info && 'client_secret' in info && typeof info.client_secret === 'string') {
    redactor.register(info.client_secret, 'client_secret');
    // Match the SDK's btoa(client_id + ':' + client_secret). Base64 is reversible,
    // so a reflected Authorization header needs the same protection as the secret.
    redactor.register(Buffer.from(`${info.client_id}:${info.client_secret}`, 'latin1').toString('base64'), 'client_credentials');
  }
  if (state.codeVerifier) redactor.register(state.codeVerifier, 'pkce_verifier');
}
