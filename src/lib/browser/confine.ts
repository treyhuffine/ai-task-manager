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
  // IPv6 (only a literal has a colon, so a hostname like fda.gov never matches):
  // unspecified, loopback, link-local, unique-local (fc00::/7), and an IPv4
  // address mapped into IPv6, judged as that IPv4 address.
  if (host.includes(':')) {
    if (host === '::' || host === '::1') return true;
    if (/^fe[89ab][0-9a-f]:/.test(host)) return true;
    if (/^f[cd][0-9a-f]{2}:/.test(host)) return true;
    const dotted = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(host);
    if (dotted) return isPrivateIp(dotted[1]);
    // The URL parser normalizes ::ffff:127.0.0.1 to ::ffff:7f00:1.
    const hex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (hex) {
      const hi = parseInt(hex[1], 16);
      const lo = parseInt(hex[2], 16);
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
    }
    return false;
  }
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

/** Whether a hostname is localhost, a private-network address, or a metadata endpoint. */
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  // Chrome resolves every *.localhost name to loopback (Ri's own portless URL is one).
  return BLOCKED_HOSTS.has(host) || host.endsWith('.localhost') || isPrivateIp(host);
}

/**
 * Whether a request the page makes may leave for this URL. The same floor as
 * navigation, applied to fetches an `evaluate` script sends (see evaluate.ts).
 * Non-network schemes (data:, blob:) never reach a host, so they pass.
 */
export function isRequestAllowed(rawUrl: string): boolean {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return false;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'ws:' && u.protocol !== 'wss:') return true;
  return !isBlockedHost(u.hostname);
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
  if (isBlockedHost(host)) {
    throw new ActionError(
      'unsupported',
      `Refusing to browse a private or loopback address (${host}).`,
      'The agent browser is for public web pages, not local services.',
    );
  }
}
