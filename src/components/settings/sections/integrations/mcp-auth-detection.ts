/**
 * What the add form shows for a probed MCP server URL, and which auth method
 * it preselects (`src/lib/integrations/mcp-auth-detect.ts` is the probe).
 * Pure, so the copy and the preselection rule are testable without rendering.
 */
import type { McpAuthDetection } from '@/lib/integrations/mcp-auth-detect';
import type { McpForm } from './types';

export type McpAuthDetectionState =
  | { status: 'idle' }
  | { status: 'checking'; url: string }
  | { status: 'done'; url: string; detection: McpAuthDetection };

/** The method a verdict preselects, or null when the person has to choose. */
export function detectedAuthKind(detection: McpAuthDetection): McpForm['authKind'] | null {
  switch (detection.method) {
    case 'none': return 'none';
    case 'oauth': return 'oauth';
    case 'key': return detection.header ? 'header' : 'bearer';
    default: return null;
  }
}

/** The verdict for the address currently in the form, if the probe has one. */
export function detectionFor(state: McpAuthDetectionState, url: string): McpAuthDetection | null {
  return state.status === 'done' && state.url === url.trim() ? state.detection : null;
}

/**
 * The auth the form will submit: the person's own choice when they made one
 * for this address, otherwise the detected method. The header name falls back
 * to the one the server's refusal named.
 */
export function resolveMcpFormAuth(form: McpForm, detected: McpAuthDetection | null): { authKind: McpForm['authKind']; header: string } {
  const detectedKind = detected ? detectedAuthKind(detected) : null;
  const authKind = form.authChosen ? form.authKind : detectedKind ?? form.authKind;
  const hint = detected?.method === 'key' ? detected.header : undefined;
  return { authKind, header: form.header.trim() || (authKind === 'header' && hint ? hint : '') };
}

/**
 * Apply an edit to the form. A new address starts over: it gets its own
 * verdict, and a method chosen for the old address doesn't carry over to it.
 * Name, header and secret stay, since they are visible in the form.
 */
export function patchMcpForm(form: McpForm, patch: Partial<McpForm>): McpForm {
  const next = { ...form, ...patch };
  const newAddress = patch.url !== undefined && patch.url.trim() !== form.url.trim();
  return newAddress ? { ...next, authKind: 'none', authChosen: false } : next;
}

export interface McpAuthSummary {
  tone: 'ok' | 'warn';
  title: string;
  detail: string;
}

export function describeMcpAuthDetection(detection: McpAuthDetection): McpAuthSummary {
  switch (detection.method) {
    case 'none':
      return { tone: 'ok', title: 'No sign-in needed', detail: `${detection.server?.name ?? 'The server'} answered without asking for credentials.` };
    case 'key':
      return { tone: 'ok', title: 'Needs an API key or token',
        detail: `The server refused the request (HTTP ${detection.status}) without offering browser sign-in.${detection.header ? ` It names the ${detection.header} header.` : ' Paste the key it gave you.'}` };
    case 'oauth': {
      const host = hostOf(detection.authorizationServer);
      const scopes = detection.scopes?.length ? ` It asks for ${listScopes(detection.scopes)}.` : '';
      const pkce = detection.pkce ? '' : " It doesn't offer PKCE S256, which Ri requires.";
      switch (detection.registration) {
        case 'dynamic':
          return { tone: detection.pkce ? 'ok' : 'warn', title: 'Sign in with your browser', detail: `Ri registers itself with ${host} and opens the sign-in page.${scopes}${pkce}` };
        case 'client_metadata':
          return { tone: 'warn', title: 'Sign in with your browser',
            detail: `${host} takes a client metadata document instead of registering clients, which Ri doesn't offer for a custom server yet. If the server also takes an API key, use that.${pkce}` };
        case 'registered':
          return { tone: 'warn', title: 'Sign in with your browser',
            detail: `${host} needs a client registered with the provider, which a custom server can't supply here. If the server also takes an API key, use that.${pkce}` };
        default:
          return { tone: 'warn', title: 'Sign in with your browser', detail: `Ri couldn't read the sign-in details at ${host}, so sign-in may need a registered client.${scopes}${pkce}` };
      }
    }
    default:
      return { tone: 'warn', title: UNKNOWN_TITLES[detection.reason], detail: `${detection.message} Choose how it authenticates below.` };
  }
}

const UNKNOWN_TITLES: Record<Extract<McpAuthDetection, { method: 'unknown' }>['reason'], string> = {
  invalid_url: 'Check the address',
  unreachable: "Couldn't reach this address",
  redirected: 'This address redirects',
  not_mcp: 'No MCP server here',
  server_error: 'The server is having trouble',
};

/** A long consent list reads as a count past the first few. */
function listScopes(scopes: string[]): string {
  return scopes.length > 4 ? `${scopes.slice(0, 3).join(', ')} and ${scopes.length - 3} more` : scopes.join(', ');
}

function hostOf(url: string): string {
  try { return new URL(url).host; } catch { return url; }
}
