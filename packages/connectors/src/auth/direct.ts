/**
 * Direct (non-OAuth) strategies (§9): they authenticate a request from a secret
 * the user supplies once — no authorization-code flow, treated as never-expiring
 * (no refresh seam). They share the same connection/secret/store path as OAuth.
 *
 * `apiKey` is the general one-secret injector: header or query placement absorbs
 * what older designs split into api_key / bearer / custom_header / query_string.
 * `bearer`/`basic` are the conventional shapes. `custom` is the escape hatch for
 * anything bespoke — it declares its secret fields (for confinement + connect UX)
 * and mutates the request directly.
 */
import type { AuthApplyContext, AuthStrategy, Credentials } from '../core/types';

export interface ApiKeyConfig {
  /** Where to place the key. Default `header`. */
  in?: 'header' | 'query';
  /** Header or query-param NAME. Default `Authorization` (header) / `api_key` (query). */
  name?: string;
  /** Prefix before the key in a header, e.g. `Bearer ` or `token `. Ignored for query. */
  prefix?: string;
}

/** One opaque secret string, placed in a header or query param. */
export function apiKey(config: ApiKeyConfig = {}): AuthStrategy {
  const where = config.in ?? 'header';
  const name = config.name ?? (where === 'header' ? 'Authorization' : 'api_key');
  const prefix = config.prefix ?? '';
  return {
    kind: 'api_key',
    applyAuth(creds: Credentials, req: AuthApplyContext): void {
      if (creds.type !== 'api_key') throw new Error('apiKey strategy received wrong credentials');
      if (where === 'query') req.addQueryParam(name, creds.apiKey);
      else req.headers[name] = `${prefix}${creds.apiKey}`;
    },
    tokenOf(creds: Credentials): string {
      if (creds.type !== 'api_key') throw new Error('apiKey strategy received wrong credentials');
      return creds.apiKey;
    },
  };
}

export function bearer(): AuthStrategy {
  return {
    kind: 'bearer',
    applyAuth(creds: Credentials, req: AuthApplyContext): void {
      if (creds.type !== 'bearer') throw new Error('bearer strategy received wrong credentials');
      req.headers.Authorization = `Bearer ${creds.token}`;
    },
    tokenOf(creds: Credentials): string {
      if (creds.type !== 'bearer') throw new Error('bearer strategy received wrong credentials');
      return creds.token;
    },
  };
}

export function basic(): AuthStrategy {
  return {
    kind: 'basic',
    applyAuth(creds: Credentials, req: AuthApplyContext): void {
      if (creds.type !== 'basic') throw new Error('basic strategy received wrong credentials');
      req.headers.Authorization = `Basic ${Buffer.from(`${creds.username}:${creds.password}`).toString('base64')}`;
    },
    tokenOf(creds: Credentials): string {
      if (creds.type !== 'basic') throw new Error('basic strategy received wrong credentials');
      return Buffer.from(`${creds.username}:${creds.password}`).toString('base64');
    },
  };
}

export interface CustomAuthConfig {
  /**
   * Names of the secret fields this strategy reads from the stored credential. Drives the
   * connect-time prompt and validation; confinement is automatic (the runtime registers every
   * value of a `custom` credential with the Redactor).
   */
  secretFields: string[];
  /** Authenticate the request from the stored secret values (set headers, query, or body). */
  apply(req: AuthApplyContext, values: Record<string, string>): void;
}

/**
 * The escape hatch for bespoke auth — anything the built-ins don't model (a vendor that wants
 * its key in the JSON body, multiple custom headers, a hand-rolled scheme). The whole long tail
 * lives here without growing the trust-spine surface.
 */
export function custom(config: CustomAuthConfig): AuthStrategy {
  return {
    kind: 'custom',
    applyAuth(creds: Credentials, req: AuthApplyContext): void {
      if (creds.type !== 'custom') throw new Error('custom strategy received wrong credentials');
      config.apply(req, creds.values);
    },
    tokenOf(): string {
      throw new Error('custom strategy has no single token; use ctx.http');
    },
  };
}
