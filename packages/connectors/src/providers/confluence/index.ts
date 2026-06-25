import type { Registry } from '../../core/registry';
import { confluence } from './provider';
import type { ConfluenceProviderOptions } from './provider';
import { confluenceToolkit } from './toolkit';

export { confluence } from './provider';
export type { ConfluenceProviderOptions } from './provider';
export { confluenceToolkit } from './toolkit';

/** Register the Confluence provider with its toolkit in one call. */
export function registerConfluence(registry: Registry, options: ConfluenceProviderOptions = {}): void {
  registry.addBundle({ provider: confluence(options), toolkits: [confluenceToolkit] });
}
