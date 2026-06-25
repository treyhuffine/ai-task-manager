/**
 * Provider-dependent AuthConfig validation (§3a) — the checks that need the `Provider` (so they
 * can't live on the provider-agnostic registry/store). Shared by the runtime's lazy first-use
 * check and the admin service's eager pre-write check, so a BYO config is rejected at add-time
 * rather than persisting and failing mysteriously at first connect.
 */
import { ConnectorError } from './errors';
import type { ConnectorErrorCode } from './errors';
import type { AuthConfig, Provider } from './types';

/** Does `granted` authorize `required` — honoring the provider's scope hierarchy (§7)? */
function scopeHeld(provider: Provider, granted: string[], required: string): boolean {
  if (granted.includes(required)) return true;
  return provider.scopeSatisfies?.(granted, required) ?? false;
}

/**
 * Throw if `config` is incompatible with `provider`: scheme must equal the provider's strategy
 * kind, and (if `allowedScopes` is set) it must cover `identityScopes ∪ defaultScopes`. `code`
 * lets callers pick the surfaced error code — `internal_error` for a code-registration misconfig
 * (runtime), `invalid_input` for user-supplied BYO input (admin).
 */
export function assertAuthConfigValidForProvider(
  config: AuthConfig,
  provider: Provider,
  code: ConnectorErrorCode = 'internal_error',
): void {
  if (config.scheme !== provider.auth.kind) {
    throw new ConnectorError(
      code,
      `AuthConfig "${config.id}" scheme "${config.scheme}" does not match provider "${provider.id}" strategy "${provider.auth.kind}"`,
    );
  }
  if (config.allowedScopes) {
    const must = new Set<string>([...(provider.identityScopes ?? []), ...(config.defaultScopes ?? [])]);
    const uncovered = [...must].filter((s) => !scopeHeld(provider, config.allowedScopes as string[], s));
    if (uncovered.length > 0) {
      throw new ConnectorError(
        code,
        `AuthConfig "${config.id}" identity/defaultScopes exceed its allowedScopes: ${uncovered.join(', ')}`,
      );
    }
  }
}
