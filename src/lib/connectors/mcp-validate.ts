/**
 * Validation + limits for user-added MCP servers (docs/connectors-mcp-ingest-spec.md §8).
 * Pure, server-only helpers used by the mcp-servers routes before persisting/ingesting.
 */

export const MCP_LIMITS = {
  /** Max MCP servers a user can add. */
  maxServers: 20,
  /** Max tools we'll ingest from one server (a runaway server shouldn't flood the model). */
  maxTools: 250,
  maxUrlLength: 2048,
  maxNameLength: 60,
  maxHeaderNameLength: 64,
} as const;

type UrlCheck = { ok: true; url: string } | { ok: false; error: string };

/**
 * Accept only `https://`, plus `http://` for loopback (local dev). Anything else is rejected.
 *
 * NOTE (hosted / SSRF): a multi-tenant deployment fetches this URL server-side, so it MUST also
 * reject hosts that resolve to private/link-local ranges or the cloud metadata IP
 * (169.254.169.254). That needs DNS resolution + range checks and is deferred for the local-first
 * build (where the user controls their own machine).
 */
export function validateMcpUrl(raw: string): UrlCheck {
  const value = (raw ?? '').trim();
  if (!value) return { ok: false, error: 'A server URL is required.' };
  if (value.length > MCP_LIMITS.maxUrlLength) return { ok: false, error: 'That URL is too long.' };
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    return { ok: false, error: 'That is not a valid URL.' };
  }
  const host = u.hostname.toLowerCase();
  const isLoopback = host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0';
  if (u.protocol === 'https:') return { ok: true, url: u.toString() };
  if (u.protocol === 'http:' && isLoopback) return { ok: true, url: u.toString() };
  return { ok: false, error: 'Use an https:// URL (http:// is allowed only for localhost).' };
}

/** A safe HTTP header name (no CRLF, conservative charset). */
export function validateHeaderName(name: string): boolean {
  return new RegExp(`^[A-Za-z0-9-]{1,${MCP_LIMITS.maxHeaderNameLength}}$`).test(name);
}
