/** The provider barrel: registerAllProviders wires every integration without collision, and the
 * catalog matches what's registered. */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../core/registry';
import { registerAllProviders, PROVIDER_CATALOG, HOSTED_MCP_PROVIDERS } from '../providers';

describe('provider catalog', () => {
  it('keeps hosted identities unique and their pinned endpoints free of embedded credentials', () => {
    expect(new Set(PROVIDER_CATALOG.map((p) => p.id)).size).toBe(PROVIDER_CATALOG.length);
    expect(new Set(HOSTED_MCP_PROVIDERS.map((p) => p.id)).size).toBe(HOSTED_MCP_PROVIDERS.length);
    for (const provider of HOSTED_MCP_PROVIDERS) {
      expect(Boolean(provider.url)).not.toBe(Boolean(provider.endpoint));
      const urls = provider.url ? [provider.url] : provider.endpoint?.kind === 'region' ? provider.endpoint.options.map((option) => option.url) : [];
      for (const value of urls) {
        const url = new URL(value);
        expect(url.protocol).toBe('https:');
        expect(url.username).toBe('');
        expect(url.password).toBe('');
        expect([...url.searchParams]).toEqual(provider.id === 'atlassian' ? [['tools', 'all']] : []);
        expect(url.hash).toBe('');
      }
      if (provider.endpoint?.kind === 'region') {
        expect(provider.endpoint.options.length).toBeGreaterThan(0);
        expect(new Set(provider.endpoint.options.map((option) => option.id)).size).toBe(provider.endpoint.options.length);
      }
      if (provider.endpoint?.kind === 'instance') expect(provider.endpoint.path).toBe('/mcp-server/http');
    }
  });

  it('registers native catalog providers without registering disconnected hosted tools', () => {
    const registry = createRegistry();
    expect(() => registerAllProviders(registry)).not.toThrow();
    const ids = registry.providers().map((p) => p.id).sort();
    expect(ids).toEqual(PROVIDER_CATALOG.filter((c) => c.method !== 'mcp').map((c) => c.id).sort());
    expect(PROVIDER_CATALOG.filter((c) => c.method === 'mcp').map((c) => c.id)).toEqual(HOSTED_MCP_PROVIDERS.map((c) => c.id));
    expect(registry.getAction('todoist.list_tasks')).toBeUndefined();
  });

  it.each([
    ['readwise', 'readwise.list_highlights'],
    ['raindrop', 'raindrop.list_collections'],
    ['gitlab', 'gitlab.list_projects'],
    ['stripe', 'stripe.list_customers'],
    ['airtable', 'airtable.list_bases'],
    ['slack', 'slack.post_message'],
    ['zoom', 'zoom.list_meetings'],
    ['hubspot', 'hubspot.list_contacts'],
    ['asana', 'asana.list_tasks'],
    ['dropbox', 'dropbox.list_folder'],
    ['box', 'box.list_folder_items'],
    ['twitter', 'twitter.create_posts'],
  ])('keeps retired native %s actions out of the registry', (providerId, actionId) => {
    const registry = createRegistry();
    registerAllProviders(registry);
    expect(PROVIDER_CATALOG.find((provider) => provider.id === providerId)?.method).toBe('mcp');
    expect(registry.getProvider(providerId)).toBeUndefined();
    expect(registry.getAction(actionId)).toBeUndefined();
  });

  it('exposes toolkits with actions for every provider', () => {
    const registry = createRegistry();
    registerAllProviders(registry);
    const toolkits = registry.toolkits();
    expect(toolkits.length).toBeGreaterThanOrEqual(PROVIDER_CATALOG.filter((c) => c.method !== 'mcp').length);
    // every toolkit has at least one action, and every action id is toolkit-namespaced
    for (const t of toolkits) {
      expect(t.actions.length).toBeGreaterThan(0);
      for (const a of t.actions) expect(a.id.startsWith(`${t.id}.`)).toBe(true);
    }
  });

  it('catalog connect methods only require pasted credentials for direct providers', () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(['oauth2', 'api_key', 'custom', 'mcp']).toContain(entry.method);
      if (entry.method === 'api_key' || entry.method === 'custom') expect(entry.credentialFields?.length).toBeGreaterThan(0);
      if (entry.method === 'mcp') expect(entry.credentialFields).toBeUndefined();
    }
  });
});
