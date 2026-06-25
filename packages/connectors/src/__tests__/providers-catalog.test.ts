/** The provider barrel: registerAllProviders wires every connector without collision, and the
 * catalog matches what's registered. */
import { describe, it, expect } from 'vitest';
import { createRegistry } from '../core/registry';
import { registerAllProviders, PROVIDER_CATALOG } from '../providers';

describe('provider catalog', () => {
  it('registers every catalog provider with no id collisions', () => {
    const registry = createRegistry();
    expect(() => registerAllProviders(registry)).not.toThrow();
    const ids = registry.providers().map((p) => p.id).sort();
    expect(ids).toEqual(PROVIDER_CATALOG.map((c) => c.id).sort());
  });

  it('exposes toolkits with actions for every provider', () => {
    const registry = createRegistry();
    registerAllProviders(registry);
    const toolkits = registry.toolkits();
    expect(toolkits.length).toBeGreaterThanOrEqual(PROVIDER_CATALOG.length);
    // every toolkit has at least one action, and every action id is toolkit-namespaced
    for (const t of toolkits) {
      expect(t.actions.length).toBeGreaterThan(0);
      for (const a of t.actions) expect(a.id.startsWith(`${t.id}.`)).toBe(true);
    }
  });

  it('catalog connect-methods are coherent (oauth2 | api_key | custom)', () => {
    for (const entry of PROVIDER_CATALOG) {
      expect(['oauth2', 'api_key', 'custom']).toContain(entry.method);
      if (entry.method !== 'oauth2') expect(entry.credentialFields?.length).toBeGreaterThan(0);
    }
  });
});
