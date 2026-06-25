/**
 * Self-signed JWT strategy: mint a fresh, short-lived JWT per request from a
 * signing key (an HS-family secret or an RS/ES-family PEM private key) and inject
 * it as a bearer.
 * For a *static*, pre-issued JWT use `bearer()` instead — this is for APIs that
 * want a freshly-signed assertion on each call (service accounts, some fintechs).
 */
import { createHmac, createSign } from 'node:crypto';
import type { AuthApplyContext, AuthStrategy, Credentials } from '../core/types';

export type JwtAlgorithm =
  | 'HS256' | 'HS384' | 'HS512'
  | 'RS256' | 'RS384' | 'RS512'
  | 'ES256' | 'ES384' | 'ES512';

export interface JwtConfig {
  algorithm: JwtAlgorithm;
  issuer?: string;
  audience?: string | string[];
  subject?: string;
  /** Token lifetime; sets `exp = iat + ttlSeconds`. Default 300s. */
  ttlSeconds?: number;
  /** Extra static claims merged into the payload. */
  claims?: Record<string, unknown>;
  /** `kid` header, when the API needs to select a key. */
  keyId?: string;
  /** Header to carry the token. Default `Authorization`. */
  header?: string;
  /** Prefix before the token. Default `Bearer `. */
  prefix?: string;
  /** Test hook — epoch ms. Defaults to wall clock. */
  now?: () => number;
}

function b64url(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url');
}

const HASH: Record<JwtAlgorithm, string> = {
  HS256: 'sha256', HS384: 'sha384', HS512: 'sha512',
  RS256: 'RSA-SHA256', RS384: 'RSA-SHA384', RS512: 'RSA-SHA512',
  ES256: 'sha256', ES384: 'sha384', ES512: 'sha512',
};

function sign(alg: JwtAlgorithm, signingInput: string, key: string): string {
  if (alg.startsWith('HS')) {
    return createHmac(HASH[alg], key).update(signingInput).digest('base64url');
  }
  const signer = createSign(HASH[alg]);
  signer.update(signingInput);
  signer.end();
  if (alg.startsWith('ES')) {
    return signer.sign({ key, dsaEncoding: 'ieee-p1363' }).toString('base64url');
  }
  return signer.sign(key).toString('base64url');
}

export function jwt(config: JwtConfig): AuthStrategy {
  const ttl = config.ttlSeconds ?? 300;
  const header = config.header ?? 'Authorization';
  const prefix = config.prefix ?? 'Bearer ';
  const nowFn = config.now ?? (() => Date.now());

  return {
    kind: 'jwt',
    applyAuth(creds: Credentials, req: AuthApplyContext): void {
      if (creds.type !== 'jwt') throw new Error('jwt strategy received wrong credentials');
      const iat = Math.floor(nowFn() / 1000);
      const jwtHeader = { alg: config.algorithm, typ: 'JWT', ...(config.keyId ? { kid: config.keyId } : {}) };
      const payload: Record<string, unknown> = {
        ...(config.claims ?? {}),
        ...(config.issuer ? { iss: config.issuer } : {}),
        ...(config.subject ? { sub: config.subject } : {}),
        ...(config.audience ? { aud: config.audience } : {}),
        iat,
        exp: iat + ttl,
      };
      const signingInput = `${b64url(JSON.stringify(jwtHeader))}.${b64url(JSON.stringify(payload))}`;
      const token = `${signingInput}.${sign(config.algorithm, signingInput, creds.key)}`;
      req.headers[header] = `${prefix}${token}`;
    },
    tokenOf(): string {
      throw new Error('jwt mints a fresh token per request; use ctx.http');
    },
  };
}
