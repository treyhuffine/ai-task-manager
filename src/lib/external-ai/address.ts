import { HOME_MCP_PATH } from './policy';

/** Use the Home's saved address, never the caller's Origin or forwarded Host. */
export function homeMcpAddress(remote: string | null, local: string): { mcpUrl: string; reachable: boolean } {
  const url = new URL(remote || local);
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use a base address without a path or credentials in Settings → Devices.');
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) {
    throw new Error('Set an HTTPS remote address in Settings → Devices before connecting an outside assistant.');
  }
  return { mcpUrl: `${url.origin}${HOME_MCP_PATH}`, reachable: Boolean(remote) && !loopback };
}
