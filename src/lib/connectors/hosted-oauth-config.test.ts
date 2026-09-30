import { describe, expect, it, vi } from 'vitest';
import { staticAuthConfigs, type AuthConfigInput } from '@connectors/engine';
import { getHostedMcpProvider } from '@connectors/engine/providers';
import { resolveHostedOAuthConfig } from './hosted-oauth-config';

const definition = getHostedMcpProvider('twitter')!;
const redirect = 'https://app.example/api/connectors/mcp-oauth/builtin_twitter';
const config = (id: string, patch: Partial<AuthConfigInput> = {}): AuthConfigInput => ({
  id, providerId: 'twitter', label: id, scheme: 'oauth2', scope: 'owner', ownerId: 'local',
  oauth: { clientId: `${id}-client`, redirectUri: redirect }, clientSecret: `${id}-secret`, status: 'active', ...patch,
});
const resolve = (configs: AuthConfigInput[], id?: string) => resolveHostedOAuthConfig(definition, staticAuthConfigs(configs), 'local', redirect, id);

describe('registered hosted OAuth client selection', () => {
  it('opens the only active visible client through the secret registry', async () => {
    const result = await resolve([config('work')]);
    expect(result.config.id).toBe('work');
    expect(result.clientSecret).toBe('work-secret');
    expect(result.config).not.toHaveProperty('clientSecret');
  });

  it('prefers the owner default over a global default', async () => {
    const result = await resolve([config('global', { scope: 'global', ownerId: undefined, isDefault: true }), config('owner', { isDefault: true })]);
    expect(result.config.id).toBe('owner');
  });

  it('uses a valid replacement when a migrated default has the native callback', async () => {
    const result = await resolve([
      config('legacy', { isDefault: true, oauth: { clientId: 'legacy-client', redirectUri: 'https://app.example/api/connectors/callback' } }),
      config('replacement'),
    ]);
    expect(result.config.id).toBe('replacement');
    expect(result.clientSecret).toBe('replacement-secret');
  });

  it('falls back from an unusable owner default to a usable global default', async () => {
    const result = await resolve([
      config('owner', { isDefault: true, clientSecret: undefined }),
      config('global', { isDefault: true, scope: 'global', ownerId: undefined }),
    ]);
    expect(result.config.id).toBe('global');
  });

  it('does not offer incompatible clients in the explicit-choice response', async () => {
    await expect(resolve([
      config('old-callback', { isDefault: true, oauth: { clientId: 'old', redirectUri: 'https://old.example/callback' } }),
      config('no-secret', { clientSecret: undefined }),
      config('overrides', { allowedScopes: ['custom'] }),
      config('one'), config('two'),
    ])).rejects.toMatchObject({
      name: 'AuthConfigRequiredError', choices: [{ authConfigId: 'one', label: 'one' }, { authConfigId: 'two', label: 'two' }],
    });
  });

  it('preserves a useful setup error when the only active app is invalid', async () => {
    await expect(resolve([config('no-secret', { clientSecret: undefined })])).rejects.toThrow('requires an OAuth client secret');
    await expect(resolve([config('old', { oauth: { clientId: 'old', redirectUri: 'https://old.example/callback' } })])).rejects.toThrow(`Register ${redirect} as the callback`);
  });

  it('requires a choice when there are multiple clients and no default', async () => {
    await expect(resolve([config('one'), config('two')])).rejects.toMatchObject({
      name: 'AuthConfigRequiredError', choices: [{ authConfigId: 'one', label: 'one' }, { authConfigId: 'two', label: 'two' }],
    });
  });

  it('keeps an explicitly bound app even when another becomes default', async () => {
    expect((await resolve([config('old'), config('new', { isDefault: true })], 'old')).config.id).toBe('old');
  });

  it.each([
    { clientSecret: undefined },
    { oauth: { clientId: 'bound', redirectUri: 'https://old.example/callback' } },
    { allowedScopes: ['custom'] },
  ])('does not replace an explicitly bound invalid app with a valid default: %j', async patch => {
    await expect(resolve([config('bound', patch), config('other', { isDefault: true })], 'bound')).rejects.toThrow();
  });

  it.each(['none' as const, undefined])('permits a public client without a secret for auth method %s', async tokenEndpointAuthMethod => {
    const publicDefinition = { ...definition, auth: { kind: 'oauth' as const, registration: 'registered' as const, tokenEndpointAuthMethod } };
    const result = await resolveHostedOAuthConfig(publicDefinition, staticAuthConfigs([config('public', { clientSecret: undefined })]), 'local', redirect);
    expect(result.config.id).toBe('public');
    expect(result.clientSecret).toBeUndefined();
  });

  it('rejects in-place identity changes while opening an explicitly bound client', async () => {
    const registry = staticAuthConfigs([config('bound'), config('other', { isDefault: true })]);
    const originalOpen = registry.openConfigForConnection.bind(registry);
    const open = vi.spyOn(registry, 'openConfigForConnection').mockImplementation(async (provider, id) => {
      const opened = await originalOpen(provider, id);
      opened!.config.oauth!.clientId = 'changed-client';
      return opened;
    });
    await expect(resolveHostedOAuthConfig(definition, registry, 'local', redirect, 'bound')).rejects.toMatchObject({ code: 'auth_config_unavailable' });
    expect(open).toHaveBeenCalledExactlyOnceWith('twitter', 'bound');
  });

  it('rechecks visibility after opening a bound client, even if the registry returned its old metadata', async () => {
    const registry = staticAuthConfigs([config('bound')]);
    const originalOpen = registry.openConfigForConnection.bind(registry);
    vi.spyOn(registry, 'openConfigForConnection').mockImplementation(async (provider, id) => {
      const opened = await originalOpen(provider, id);
      const snapshot = structuredClone(opened);
      opened!.config.ownerId = 'different-owner';
      return snapshot;
    });
    await expect(resolveHostedOAuthConfig(definition, registry, 'local', redirect, 'bound')).rejects.toMatchObject({ code: 'auth_config_unavailable' });
  });

  it('rejects a selected default whose secret changes while checking other candidates', async () => {
    const registry = staticAuthConfigs([config('chosen', { isDefault: true }), config('other')]);
    const originalOpen = registry.openConfigForConnection.bind(registry);
    let chosenOpens = 0;
    vi.spyOn(registry, 'openConfigForConnection').mockImplementation(async (provider, id) => {
      const opened = await originalOpen(provider, id);
      if (id === 'chosen' && ++chosenOpens > 1) return { ...opened!, clientSecret: 'replacement-secret' };
      return opened;
    });
    await expect(resolveHostedOAuthConfig(definition, registry, 'local', redirect)).rejects.toMatchObject({ code: 'auth_config_unavailable' });
    expect(chosenOpens).toBe(2);
  });

  it('propagates registry failures instead of silently treating a damaged default as an absent client', async () => {
    const registry = staticAuthConfigs([config('broken', { isDefault: true }), config('other')]);
    const originalOpen = registry.openConfigForConnection.bind(registry);
    vi.spyOn(registry, 'openConfigForConnection').mockImplementation(async (provider, id) => {
      if (id === 'broken') throw new Error('Secret store unavailable');
      return originalOpen(provider, id);
    });
    await expect(resolveHostedOAuthConfig(definition, registry, 'local', redirect)).rejects.toThrow('Secret store unavailable');
  });

  it.each([
    { ownerId: 'another-owner' }, { scope: 'tenant' as const, tenantId: 'another-tenant' },
    { status: 'disabled' as const }, { status: 'archived' as const }, { providerId: 'box' },
  ])('rejects inaccessible or inactive selected clients: %j', async patch => {
    await expect(resolve([config('wrong', patch)], 'wrong')).rejects.toMatchObject({ code: 'auth_config_unavailable' });
  });

  it('reports missing setup without attempting another registration mechanism', async () => {
    await expect(resolve([])).rejects.toMatchObject({ code: 'provider_not_configured' });
  });

  it.each([
    { clientSecret: undefined },
    { oauth: { clientId: ' ', redirectUri: redirect } },
    { oauth: { clientId: 'old-native', redirectUri: 'https://app.example/api/connectors/callback' } },
    { baseUrl: 'https://different.example' }, { defaultScopes: ['custom'] }, { allowedScopes: ['custom'] },
  ])('rejects incomplete or incompatible client configuration: %j', async patch => {
    await expect(resolve([config('bad', patch)])).rejects.toThrow();
  });
});
