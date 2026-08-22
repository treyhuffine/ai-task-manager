/**
 * The silent private-network floor.
 *
 * Security is the login scope the user curates, not a cage on the agent (see
 * the proposal, section 6). The one exception is this floor: the agent browser
 * cannot be steered to localhost, a private-network address, or a cloud
 * metadata endpoint. It restricts nothing a user would legitimately browse and
 * closes the one hole unrelated to their logins.
 */

import { ActionError } from '@/lib/orchestrator/types';

const BLOCKED_HOSTS = new Set([
  'localhost',
  'metadata.google.internal',
  'metadata.goog',
]);

function ipv4Parts(host: string): number[] | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return null;
  const parts = m.slice(1).map(Number);
  if (parts.some((p) => p > 255)) return null;
  return parts;
}

function isPrivateIp(host: string): boolean {
  // IPv6 loopback / link-local.
  if (host === '::1' || host.startsWith('fe80:') || host.startsWith('fc') || host.startsWith('fd')) return true;
  const parts = ipv4Parts(host);
  if (!parts) return false;
  const [a, b] = parts;
  if (a === 127) return true; // loopback
  if (a === 10) return true; // private
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 169 && b === 254) return true; // link-local + cloud metadata (169.254.169.254)
  if (a === 0) return true;
  return false;
}

/** Throw if a URL points at a private, loopback, or metadata address. */
export function assertNavigable(rawUrl: string): void {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new ActionError('invalid_params', `Invalid URL: ${rawUrl}`);
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw new ActionError('unsupported', `Only http and https are allowed, not ${u.protocol}`);
  }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (BLOCKED_HOSTS.has(host) || isPrivateIp(host)) {
    throw new ActionError(
      'unsupported',
      `Refusing to browse a private or loopback address (${host}).`,
      'The agent browser is for public web pages, not local services.',
    );
  }
}
