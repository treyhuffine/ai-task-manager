/**
 * HTTP/2 mode resolution (see docs/optional-http2.md §3).
 *
 * Precedence: explicit CLI option, then `FLOW_HTTP2`, then disabled. The flag
 * is a runtime deployment choice only — it is never persisted to SQLite, never
 * an `NEXT_PUBLIC_*` value, and changing it requires an ordinary stop/start.
 */

import crypto from 'node:crypto';

export const HTTP2_ENV = 'FLOW_HTTP2';

/** Documented truthy/falsy environment values. Anything else is an error. */
const TRUE_VALUES = new Set(['1', 'true']);
const FALSE_VALUES = new Set(['0', 'false']);

export interface Http2FlagInput {
  /** `true` from `--http2`, `false` from `--no-http2`, `undefined` if neither. */
  http2?: boolean;
}

/**
 * Parse `FLOW_HTTP2`. Returns a boolean for a documented value, null if unset,
 * and throws on an unrecognized value so a typo fails loudly instead of
 * silently disabling the feature.
 */
function parseHttp2Env(raw: string | undefined): boolean | null {
  if (raw === undefined) return null;
  const v = raw.trim().toLowerCase();
  if (v === '') return null;
  if (TRUE_VALUES.has(v)) return true;
  if (FALSE_VALUES.has(v)) return false;
  throw new Error(
    `Invalid ${HTTP2_ENV}=${JSON.stringify(raw)}. Use one of: 1, 0, true, false.`,
  );
}

/**
 * Resolve whether the HTTP/2 gateway should front this launch. Explicit CLI
 * intent (`--http2` / `--no-http2`) always wins; otherwise `FLOW_HTTP2`;
 * otherwise disabled (the existing direct-HTTP default).
 */
export function resolveHttp2Enabled(
  opts: Http2FlagInput,
  env: Record<string, string | undefined> = process.env,
): boolean {
  if (typeof opts.http2 === 'boolean') return opts.http2;
  const fromEnv = parseHttp2Env(env[HTTP2_ENV]);
  if (fromEnv !== null) return fromEnv;
  return false;
}

/**
 * True when a readiness-probe failure detail indicates ONLY that the certificate
 * chain is not trusted by our local probe (as opposed to expiry, wrong host, a
 * failed health check, a connection error, or an h2 negotiation failure). Only
 * this class of failure may proceed for an explicitly supplied certificate — the
 * browser might trust a CA the local probe cannot see. Everything else is fatal.
 */
export function isChainTrustFailure(detail: string | undefined): boolean {
  if (!detail) return false;
  return /unable to verify the first certificate|self.?signed certificate|unable to get (local )?issuer|DEPTH_ZERO_SELF_SIGNED|SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|UNABLE_TO_GET_ISSUER/i.test(
    detail,
  );
}

/**
 * True if a certificate's subject / SANs cover `host`. Used to reject a supplied
 * certificate that does not match the public host up front, independently of the
 * readiness probe (whose TLS error can mask a hostname mismatch behind an
 * untrusted-issuer error).
 */
export function certCoversHost(certPem: string, host: string): boolean {
  try {
    return !!new crypto.X509Certificate(certPem).checkHost(host);
  } catch {
    return false;
  }
}
