/**
 * Error taxonomy (§13). `ConnectorError` carries a stable `code` so every
 * surface (programmatic, AI-SDK, MCP) renders failures the same way.
 */

export type ConnectorErrorCode =
  | 'unknown_action'
  | 'unknown_provider'
  | 'connection_not_found'
  | 'invalid_input'
  | 'denied'
  | 'provider_error'
  | 'provider_rate_limited'
  | 'provider_unavailable'
  | 'provider_not_configured'   // no auth client/app resolves for this provider (+caller, in hosted mode)
  | 'conflict'                  // admin op conflicts with state (delete a config with live connections, §9)
  | 'internal_error'
  // completeAuth: an `add_scopes` re-consent resolved to a different account OR a different
  // auth config than the connection being upgraded/revived (§7, authconfig §6).
  | 'consent_account_mismatch'
  // Multi-client layer (connectors-authconfig-spec.md §6a). Emitted only once a provider has >1
  // auth config; a single-config provider never reaches these.
  | 'auth_config_ambiguous_default'   // two `isDefault` candidates at the same visibility level (§4a)
  | 'scope_not_allowed'               // requested scopes exceed the resolved config's allowedScopes
  | 'auth_config_unavailable';        // the resolved config's lifecycle status forbids the flow's purpose (§8)

export interface ConnectorErrorOptions {
  /** True when a mutating request failed *after* it crossed the wire (§5/§13). */
  indeterminate?: boolean;
  /** Provider HTTP status, when the error originated from a provider call. */
  status?: number;
  /** Seconds to wait, surfaced from a 429 `Retry-After`. */
  retryAfter?: number;
  cause?: unknown;
}

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly indeterminate: boolean;
  readonly status?: number;
  readonly retryAfter?: number;

  constructor(code: ConnectorErrorCode, message: string, opts: ConnectorErrorOptions = {}) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = 'ConnectorError';
    this.code = code;
    this.indeterminate = opts.indeterminate ?? false;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
  }
}

import type { AuthConfigChoice } from './types';

/**
 * Thrown by `beginAuth` (the host-driven entrypoint) when a connect is needed but >1 auth
 * client is visible and none resolves as the default (authconfig spec §6/§6a). `runAction` (the
 * agent path) *returns* the equivalent `auth_config_required` outcome instead. The host catches
 * this, calls `listForProvider`, shows a picker, then re-invokes `beginAuth({ authConfigId })`.
 * Distinct from `ConnectorError` because it carries picker `choices` and isn't an error *code*.
 */
export class AuthConfigRequiredError extends Error {
  readonly providerId: string;
  readonly choices: AuthConfigChoice[];
  constructor(providerId: string, choices: AuthConfigChoice[]) {
    super(`provider "${providerId}" has more than one connection method; choose one`);
    this.name = 'AuthConfigRequiredError';
    this.providerId = providerId;
    this.choices = choices;
  }
}

export function isAuthConfigRequiredError(e: unknown): e is AuthConfigRequiredError {
  return e instanceof AuthConfigRequiredError;
}

/**
 * Internal control-flow signal: refresh failed unrecoverably / the grant was
 * revoked. The runtime catches it, flips the connection to `needs_reauth`, and
 * returns an `auth_required` outcome (§9). Never surfaces to callers directly.
 */
export class NeedsReauthError extends Error {
  readonly connectionId: string;
  constructor(connectionId: string, message = 'connection needs re-authentication') {
    super(message);
    this.name = 'NeedsReauthError';
    this.connectionId = connectionId;
  }
}

export function isConnectorError(e: unknown): e is ConnectorError {
  return e instanceof ConnectorError;
}
