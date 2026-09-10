/**
 * Header translation between the public HTTP/2 (or HTTPS/1.1) edge and the
 * private HTTP/1.1 Next upstream (see docs/optional-http2.md §5).
 *
 * Rules enforced here:
 *   - Drop HTTP/2 pseudo-headers (`:method` etc.) and HTTP/1.1 hop-by-hop
 *     headers in both directions, plus any header named by `Connection`.
 *     Existing SSE responses carry `Connection: keep-alive`, which is illegal
 *     to place on an HTTP/2 response and must not be forwarded.
 *   - Never copy `Transfer-Encoding` into an HTTP/2 response.
 *   - Replace client-supplied forwarding hints with canonical values derived
 *     from the gateway's validated public authority and TLS connection.
 *   - Preserve authorization, cookies, multiple Set-Cookie values, content
 *     encoding, and cache validators untouched.
 *   - Rewrite an absolute `Location` only when it targets a known launcher-owned
 *     private upstream authority, substituting the public HTTPS origin.
 */

import type { IncomingHttpHeaders } from 'node:http';

export type OutgoingHeaders = Record<string, string | string[]>;

/** RFC 9110 hop-by-hop headers — never forwarded end to end. */
const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'trailers',
  'transfer-encoding',
  'upgrade',
]);

/** Client-supplied forwarding hints the gateway always overwrites. */
const FORWARDING_HINTS = new Set([
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-forwarded-port',
]);

export interface HeaderTranslationConfig {
  /** Canonical public origin, e.g. `https://localhost:4224`. No trailing slash. */
  publicBaseUrl: string;
  /** `host:port` of the public origin, forwarded upstream as `Host`. */
  publicHostHeader: string;
  /** Public port number, for `X-Forwarded-Port`. */
  publicPort: number;
  /** `host:port` authorities that identify the private backend for Location rewrite. */
  privateAuthorities: Set<string>;
}

/** Lowercased token set from a `Connection` header value. */
function connectionTokens(headers: IncomingHttpHeaders): Set<string> {
  const raw = headers['connection'];
  if (!raw) return new Set();
  const value = Array.isArray(raw) ? raw.join(',') : raw;
  return new Set(
    value
      .split(',')
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** Concatenate split Cookie fields per HTTP cookie rules (`; ` separator). */
function normalizeCookie(value: string | string[]): string {
  return Array.isArray(value) ? value.join('; ') : value;
}

export interface BuildRequestHeadersOptions {
  /** Client remote address, appended to `X-Forwarded-For`. */
  remoteAddress?: string;
  /** Preserve `Connection`/`Upgrade` for a WebSocket Upgrade forward (HMR). */
  keepUpgrade?: boolean;
}

/**
 * Build the upstream request headers for a proxied request. Strips pseudo,
 * hop-by-hop, Connection-named, and forwarding-hint headers, normalizes Cookie,
 * and sets canonical Host / X-Forwarded-* values the app can trust.
 */
export function buildUpstreamRequestHeaders(
  inHeaders: IncomingHttpHeaders,
  cfg: HeaderTranslationConfig,
  opts: BuildRequestHeadersOptions = {},
): OutgoingHeaders {
  const out: OutgoingHeaders = {};
  const conn = connectionTokens(inHeaders);

  for (const [key, value] of Object.entries(inHeaders)) {
    if (value === undefined) continue;
    const lk = key.toLowerCase();
    if (lk.startsWith(':')) continue; // HTTP/2 pseudo-header
    if (lk === 'host') continue; // set canonically below
    if (FORWARDING_HINTS.has(lk)) continue; // overwritten below
    const isUpgradeHeader = lk === 'connection' || lk === 'upgrade';
    if (HOP_BY_HOP.has(lk) && !(opts.keepUpgrade && isUpgradeHeader)) continue;
    if (conn.has(lk) && !(opts.keepUpgrade && isUpgradeHeader)) continue;

    out[lk] = lk === 'cookie' ? normalizeCookie(value) : value;
  }

  out['host'] = cfg.publicHostHeader;
  out['x-forwarded-proto'] = 'https';
  out['x-forwarded-host'] = cfg.publicHostHeader;
  out['x-forwarded-port'] = String(cfg.publicPort);
  if (opts.remoteAddress) out['x-forwarded-for'] = opts.remoteAddress;

  return out;
}

/**
 * Build the downstream response headers. Strips hop-by-hop / Connection-named
 * headers (so `Connection: keep-alive` and `Transfer-Encoding` never reach an
 * HTTP/2 response), preserves everything else including multiple Set-Cookie
 * values, and rewrites a private-backend `Location` to the public origin.
 */
export function buildDownstreamResponseHeaders(
  inHeaders: IncomingHttpHeaders,
  cfg: HeaderTranslationConfig,
): OutgoingHeaders {
  const out: OutgoingHeaders = {};
  const conn = connectionTokens(inHeaders);

  for (const [key, value] of Object.entries(inHeaders)) {
    if (value === undefined) continue;
    const lk = key.toLowerCase();
    if (lk.startsWith(':')) continue;
    if (HOP_BY_HOP.has(lk)) continue;
    if (conn.has(lk)) continue;

    if (lk === 'location' && typeof value === 'string') {
      out[lk] = rewriteLocation(value, cfg);
      continue;
    }
    out[lk] = value;
  }

  return out;
}

/**
 * Rewrite an absolute Location that targets the private backend to the public
 * HTTPS origin, retaining path/query/fragment. Relative Locations and unrelated
 * external URLs (e.g. OAuth callbacks) pass through unchanged.
 */
export function rewriteLocation(value: string, cfg: HeaderTranslationConfig): string {
  let target: URL;
  try {
    target = new URL(value);
  } catch {
    return value; // relative Location — leave untouched
  }
  const pub = new URL(cfg.publicBaseUrl);

  // A redirect to the launcher-owned private backend authority → rewrite to the
  // public origin (scheme + host).
  if (cfg.privateAuthorities.has(target.host)) {
    target.protocol = pub.protocol;
    target.host = pub.host;
    return target.toString();
  }

  // A self-referential redirect to the public host but the wrong scheme. Next
  // builds absolute URLs (e.g. OAuth callbacks) from its loopback HTTP
  // connection, so they come back as `http://<publichost>/…`; upgrade the scheme
  // to the canonical public one so the browser stays on-origin instead of being
  // bounced to a plaintext URL against the TLS-only port.
  if (target.host === pub.host && target.protocol !== pub.protocol) {
    target.protocol = pub.protocol;
    return target.toString();
  }

  return value;
}

/**
 * The set of `host:port` authorities that identify the launcher-owned private
 * upstream, so a redirect Next builds from its private listening address is
 * rewritten to the public origin.
 */
export function privateAuthoritiesFor(upstreamHost: string, upstreamPort: number): Set<string> {
  return new Set([
    `${upstreamHost}:${upstreamPort}`,
    `127.0.0.1:${upstreamPort}`,
    `localhost:${upstreamPort}`,
    `[::1]:${upstreamPort}`,
  ]);
}
