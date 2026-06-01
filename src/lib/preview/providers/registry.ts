/**
 * Provider registry. Built-ins register at module load (see
 * `./index.ts`); community plugins call `registerPreviewProvider`.
 *
 * Stored on `globalThis` so Next.js dev-mode module reloading doesn't fork
 * the map (and silently lose a plugin's registration on hot-reload).
 */

import type { PreviewProvider } from './types';

interface RegistryState {
  providers: Map<string, PreviewProvider>;
}

declare global {
  // eslint-disable-next-line no-var
  var __flowPreviewProviders: RegistryState | undefined;
}

function state(): RegistryState {
  if (!globalThis.__flowPreviewProviders) {
    globalThis.__flowPreviewProviders = { providers: new Map() };
  }
  return globalThis.__flowPreviewProviders;
}

/**
 * Register a provider (built-in or community plugin). Last registration for
 * an id wins, so a plugin can intentionally override a built-in.
 */
export function registerPreviewProvider(provider: PreviewProvider): void {
  if (!provider.id || !/^[a-z0-9][a-z0-9-]*$/.test(provider.id)) {
    throw new Error(`registerPreviewProvider: invalid id ${JSON.stringify(provider.id)} (use lowercase [a-z0-9-])`);
  }
  state().providers.set(provider.id, provider);
}

/** Look up a provider by id, or undefined if not registered. */
export function tryGetProvider(id: string): PreviewProvider | undefined {
  return state().providers.get(id);
}

/** Look up a provider by id. Throws a clear error for an unknown id. */
export function getProvider(id: string): PreviewProvider {
  const provider = state().providers.get(id);
  if (!provider) {
    const known = listProviderIds().join(', ') || '(none registered)';
    throw new Error(`Unknown preview provider "${id}". Registered: ${known}.`);
  }
  return provider;
}

/** All registered providers, in registration order. */
export function listProviders(): PreviewProvider[] {
  return Array.from(state().providers.values());
}

export function listProviderIds(): string[] {
  return Array.from(state().providers.keys());
}

/** Test/seam helper — drop a registration (used by plugin tests). */
export function unregisterPreviewProvider(id: string): void {
  state().providers.delete(id);
}
