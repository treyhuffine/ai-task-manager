/**
 * `staticOAuthApps` — the original single-client-per-provider helper, now a thin alias over
 * {@link staticAuthConfigs} (authconfig spec §5). Each entry becomes one `global`, `oauth2`,
 * default `AuthConfig`, so existing wiring and the test page keep working unchanged while the
 * runtime threads everything through the multi-client `AuthConfigRegistry`.
 */
import { staticAuthConfigs } from './auth-configs';
import type { AuthConfigRegistry, OAuthAppConfig } from './core/types';

/** @deprecated Prefer {@link staticAuthConfigs}; retained for back-compat. */
export function staticOAuthApps(apps: Record<string, OAuthAppConfig>): AuthConfigRegistry {
  return staticAuthConfigs(apps);
}
