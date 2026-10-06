import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { ByoPanel } from './byo-panel';
import { oauthAppRedirectUri, type ProviderStatus } from './types';

const registered: ProviderStatus = {
  id: 'registered-fixture', displayName: 'Registered service', method: 'mcp', configured: false,
  mcp: { requiresAuth: true, oauthRegistration: 'registered', redirectUri: 'https://app.example/api/integrations/mcp-oauth/builtin_fixture' },
};
function render(overrides: Partial<ComponentProps<typeof ByoPanel>> = {}) {
  return renderToStaticMarkup(createElement(ByoPanel, {
    provider: registered, redirectUri: 'https://wrong.example/native-callback', copied: false, onCopyRedirect: vi.fn(),
    configs: [], form: { label: 'Work', clientId: 'client-id', clientSecret: '' }, busy: false,
    onField: vi.fn(), onAdd: vi.fn(), onConnect: vi.fn(), onSetDefault: vi.fn(), onDelete: vi.fn(), ...overrides,
  }));
}

describe('registered hosted OAuth app setup', () => {
  it('uses the stable hosted callback even in a desktop context', () => {
    const provider: ProviderStatus = { ...registered, desktopCallback: { kind: 'loopback' } };
    expect(oauthAppRedirectUri(provider, 'https://wrong.example/callback')).toBe(registered.mcp!.redirectUri);
    const html = render({ provider });
    expect(html).toContain(registered.mcp!.redirectUri);
    expect(html).toContain('Client ID');
    expect(html).toContain('placeholder="Client secret"');
    expect(html).not.toContain('Client secret (if required)');
    expect(html).toContain('stored encrypted');
    expect(html).not.toContain('temporary port');
    expect(html).not.toContain('wrong.example');
    expect(html).not.toContain('127.0.0.1');
  });

  it('does not invent a callback when the stable callback is unavailable', () => {
    const provider = { ...registered, mcp: { ...registered.mcp!, redirectUri: undefined } };
    expect(oauthAppRedirectUri(provider, 'https://wrong.example/callback')).toBe('');
    const html = render({ provider });
    expect(html).toContain('Callback address unavailable');
    expect(html).toMatch(/<button(?=[^>]*title="Copy redirect URI")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*?Add app/);
    expect(html).not.toContain('wrong.example');
  });

  it('requires a secret for registered apps without imposing that requirement on native public clients', () => {
    expect(render()).toMatch(/<button[^>]*disabled=""[^>]*>.*?Add app/);
    expect(render({ form: { label: 'Work', clientId: 'id', clientSecret: 'secret' } })).not.toMatch(/<button[^>]*disabled=""[^>]*>.*?Add app/);
    const native: ProviderStatus = { id: 'quickbooks', displayName: 'QuickBooks', method: 'oauth2', configured: false };
    const html = render({ provider: native });
    expect(html).toContain('Client secret (if required)');
    expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>.*?Add app/);
  });

  it('allows reconnect with the saved app while preventing switching or deleting that app', () => {
    const html = render({
      provider: { ...registered, configured: true, mcp: { ...registered.mcp!, authConfigId: 'saved' } },
      configs: [
        { id: 'saved', providerId: registered.id, label: 'Saved', isDefault: false, status: 'active' },
        { id: 'other', providerId: registered.id, label: 'Other', isDefault: true, status: 'active' },
      ],
    });
    expect(html).toContain('Disconnect before changing or removing its OAuth app.');
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="Connect using Saved")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toMatch(/<button(?=[^>]*aria-label="Connect using Other")(?=[^>]*disabled="")[^>]*>/);
    expect(html).toMatch(/<button(?=[^>]*aria-label="Remove Saved")(?=[^>]*disabled="")[^>]*>/);
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="Remove Other")(?=[^>]*disabled="")[^>]*>/);
  });

  it('requires endpoint setup before connecting through a registered app', () => {
    const html = render({ connectDisabled: true, configs: [{ id: 'app', providerId: registered.id, label: 'App', isDefault: true, status: 'active' }] });
    expect(html).toMatch(/<button(?=[^>]*aria-label="Connect using App")(?=[^>]*disabled="")[^>]*>/);
  });

  it('protects apps bound to other accounts without binding a new account to them', () => {
    const html = render({
      provider: { ...registered, configured: true }, usedAuthConfigIds: ['used'],
      configs: [
        { id: 'used', providerId: registered.id, label: 'Used app', isDefault: true, status: 'active' },
        { id: 'unused', providerId: registered.id, label: 'Unused app', isDefault: false, status: 'active' },
      ],
    });
    expect(html).toMatch(/<button(?=[^>]*aria-label="Remove Used app")(?=[^>]*disabled="")[^>]*>/);
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="Remove Unused app")(?=[^>]*disabled="")[^>]*>/);
    expect(html).not.toMatch(/<button(?=[^>]*aria-label="Connect using Unused app")(?=[^>]*disabled="")[^>]*>/);
    expect(html).not.toContain('Disconnect before changing or removing its OAuth app.');
  });

  it('preserves native OAuth callback behavior', () => {
    const native: ProviderStatus = { id: 'quickbooks', displayName: 'QuickBooks', method: 'oauth2', configured: false };
    expect(oauthAppRedirectUri(native, 'https://native.example/callback')).toBe('https://native.example/callback');
    expect(oauthAppRedirectUri({ ...native, desktopCallback: { kind: 'relay', redirectUri: 'https://relay.example/callback' } }, 'https://native.example/callback')).toBe('https://relay.example/callback');
    const html = render({ provider: { ...native, desktopCallback: { kind: 'loopback' } } });
    expect(html).toContain('temporary port');
    expect(html).not.toContain('builtin_fixture');
  });
});
