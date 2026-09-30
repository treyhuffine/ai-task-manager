import { AuthConfigRequiredError, ConnectorError, type AuthConfig, type AuthConfigRegistry, type ResolvedAuthConfig } from '@connectors/engine';
import type { HostedMcpProvider } from '@connectors/engine/providers';

export function usesRegisteredOAuth(definition: HostedMcpProvider | undefined): boolean {
  return definition?.auth?.kind === 'oauth' && definition.auth.registration === 'registered';
}

/** An incompatible saved app may be skipped during automatic selection. */
class UnusableOAuthConfigError extends Error {}

function configurationChanged(): never {
  throw new ConnectorError('auth_config_unavailable', 'The OAuth app changed during setup. Try again.');
}

/** Resolve through the same encrypted client store used by native connectors. */
export async function resolveHostedOAuthConfig(
  definition: HostedMcpProvider,
  registry: AuthConfigRegistry,
  ownerId: string,
  redirectUri: string,
  selectedId?: string,
): Promise<ResolvedAuthConfig> {
  // A registry may return shared objects. Snapshot metadata before opening any
  // secret so an in-place mutation cannot change both sides of a comparison.
  const configs = structuredClone((await registry.listForConnect(definition.id, { ownerId }))
    .filter(config => config.status === 'active' && config.scheme === 'oauth2' && config.oauth));
  const method = definition.auth?.kind === 'oauth' ? definition.auth.tokenEndpointAuthMethod : undefined;
  const secretRequired = method === 'client_secret_basic' || method === 'client_secret_post';
  const open = async (config: AuthConfig): Promise<ResolvedAuthConfig> => {
    if (typeof config.oauth?.clientId !== 'string' || !config.oauth.clientId.trim()) throw new UnusableOAuthConfigError('This connector requires an OAuth client ID. Add it in Settings.');
    if (config.oauth.redirectUri !== redirectUri) {
      throw new UnusableOAuthConfigError(`Register ${redirectUri} as the callback and add an OAuth app with that callback in Settings.`);
    }
    if (config.baseUrl || config.allowedScopes?.length || config.defaultScopes?.length) {
      throw new UnusableOAuthConfigError('Hosted connectors use their catalog address and provider consent scopes. Add an OAuth app without API address or scope overrides.');
    }
    const opened = await registry.openConfigForConnection(definition.id, config.id);
    if (!opened || JSON.stringify(opened.config) !== JSON.stringify(config)) return configurationChanged();
    if (secretRequired && !opened.clientSecret?.trim()) throw new UnusableOAuthConfigError('This connector requires an OAuth client secret. Add it in Settings.');
    return { ...opened, config };
  };
  const confirm = async (opened: ResolvedAuthConfig): Promise<ResolvedAuthConfig> => {
    const current = (await registry.listForConnect(definition.id, { ownerId })).find(config => config.id === opened.config.id);
    if (!current || JSON.stringify(current) !== JSON.stringify(opened.config)) return configurationChanged();
    return opened;
  };

  if (selectedId !== undefined) {
    const chosen = configs.find(config => config.id === selectedId);
    if (!chosen) throw new ConnectorError('auth_config_unavailable', 'The selected OAuth app is unavailable. Configure an active app in Settings.');
    return confirm(await open(chosen));
  }

  const usable: ResolvedAuthConfig[] = [];
  let onlyError: UnusableOAuthConfigError | undefined;
  for (const config of configs) {
    try { usable.push(await open(config)); }
    catch (error) {
      // A concurrent edit or registry failure must not silently choose a
      // different account. Only known setup incompatibilities are skipped.
      if (!(error instanceof UnusableOAuthConfigError)) throw error;
      onlyError = error;
    }
  }
  const defaults = usable.filter(candidate => candidate.config.isDefault);
  const chosen = defaults.find(candidate => candidate.config.scope === 'owner') ??
    defaults.find(candidate => candidate.config.scope === 'global') ??
    (usable.length === 1 ? usable[0] : undefined);
  if (!chosen && usable.length > 1) throw new AuthConfigRequiredError(definition.id, usable.map(({ config }) => ({
    authConfigId: config.id, label: config.label ?? definition.displayName,
  })));
  if (!chosen) {
    if (configs.length === 1 && onlyError) throw onlyError;
    throw new ConnectorError('provider_not_configured', `Add your ${definition.displayName} OAuth app in Settings before connecting.`);
  }
  // Opening other candidates may have yielded while the selected client was
  // replaced. Re-open it and confirm visibility, identity, and secret stability.
  let current: ResolvedAuthConfig;
  try { current = await open(chosen.config); }
  catch (error) {
    if (error instanceof UnusableOAuthConfigError) return configurationChanged();
    throw error;
  }
  if (current.clientSecret !== chosen.clientSecret) return configurationChanged();
  return confirm(current);
}
