/**
 * OAuth 1.0a (HMAC-SHA1) request signer (RFC 5849). Unlike OAuth2 there is no
 * stored access token to inject — each request is *signed*: the strategy builds a
 * signature base string over the method, URL, and parameters, HMACs it with the
 * consumer+token secrets, and writes the `Authorization: OAuth …` header.
 *
 * Used by a shrinking but real set of APIs (Trello, X/Twitter v1.1, some legacy).
 * Query params and `application/x-www-form-urlencoded` body params are included in
 * the base string per spec; JSON bodies are not (they aren't form parameters).
 */
import { createHmac, randomBytes } from 'node:crypto';
import type { AuthApplyContext, AuthStrategy, Credentials } from '../core/types';

export interface OAuth1Config {
  /** Optional realm for the Authorization header. */
  realm?: string;
  /** Test hook — deterministic nonce. Defaults to random. */
  nonce?: () => string;
  /** Test hook — deterministic timestamp (seconds). Defaults to wall clock. */
  timestamp?: () => number;
}

/** RFC 3986 percent-encoding (stricter than encodeURIComponent). */
function pe(s: string): string {
  return encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function paramString(params: Array<[string, string]>): string {
  return params
    .map(([k, v]) => [pe(k), pe(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export function oauth1(config: OAuth1Config = {}): AuthStrategy {
  const nonceFn = config.nonce ?? (() => randomBytes(16).toString('hex'));
  const tsFn = config.timestamp ?? (() => Math.floor(Date.now() / 1000));

  return {
    kind: 'oauth1',
    applyAuth(creds: Credentials, req: AuthApplyContext): void {
      if (creds.type !== 'oauth1') throw new Error('oauth1 strategy received wrong credentials');

      const u = new URL(req.url);
      const oauthParams: Record<string, string> = {
        oauth_consumer_key: creds.consumerKey,
        oauth_nonce: nonceFn(),
        oauth_signature_method: 'HMAC-SHA1',
        oauth_timestamp: String(tsFn()),
        oauth_version: '1.0',
        ...(creds.token ? { oauth_token: creds.token } : {}),
      };

      // Collect signed parameters: oauth_*, query string, and form-encoded body params.
      const collected: Array<[string, string]> = Object.entries(oauthParams);
      u.searchParams.forEach((v, k) => collected.push([k, v]));
      const ct = (req.headers['Content-Type'] ?? req.headers['content-type'] ?? '').toLowerCase();
      if (req.body && ct.includes('application/x-www-form-urlencoded')) {
        new URLSearchParams(req.body).forEach((v, k) => collected.push([k, v]));
      }

      const baseUrl = `${u.protocol}//${u.host}${u.pathname}`;
      const baseString = [req.method.toUpperCase(), pe(baseUrl), pe(paramString(collected))].join('&');
      const signingKey = `${pe(creds.consumerSecret)}&${pe(creds.tokenSecret ?? '')}`;
      const signature = createHmac('sha1', signingKey).update(baseString).digest('base64');

      const headerParams: Record<string, string> = { ...oauthParams, oauth_signature: signature };
      const header =
        'OAuth ' +
        (config.realm ? `realm="${pe(config.realm)}", ` : '') +
        Object.keys(headerParams)
          .sort()
          .map((k) => `${pe(k)}="${pe(headerParams[k] as string)}"`)
          .join(', ');
      req.headers.Authorization = header;
    },
    tokenOf(): string {
      throw new Error('oauth1 signs each request; there is no static token (use ctx.http)');
    },
  };
}
