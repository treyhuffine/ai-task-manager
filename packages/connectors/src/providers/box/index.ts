import type { Registry } from '../../core/registry';
import { box } from './provider';
import type { BoxProviderOptions } from './provider';
import { boxToolkit } from './toolkit';

export { box } from './provider';
export type { BoxProviderOptions } from './provider';
export { boxToolkit } from './toolkit';

/** Register the Box provider + toolkit (OAuth2). */
export function registerBox(registry: Registry, options: BoxProviderOptions = {}): void {
  registry.addBundle({ provider: box(options), toolkits: [boxToolkit] });
}
