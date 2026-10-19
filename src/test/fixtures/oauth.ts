/**
 * The client type MCP SDK 2.x states in dynamic registration (SEP-837): a loopback or custom-scheme
 * callback is a native app, anything else a web app. Tests state it so a registration body is
 * compared in full.
 */
export function expectedApplicationType(redirectUri: string): 'native' | 'web' {
  const url = new URL(redirectUri);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const loopback = host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1' || host === '::1';
  return url.protocol !== 'http:' && url.protocol !== 'https:' ? 'native' : loopback ? 'native' : 'web';
}
