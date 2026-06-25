import type { Registry } from '../../core/registry';
import { linear } from './provider';
import type { LinearProviderOptions } from './provider';
import { linearToolkit } from './toolkit';

export { linear } from './provider';
export type { LinearProviderOptions } from './provider';
export { linearToolkit } from './toolkit';

/** Register the Linear provider with its issue toolkit. */
export function registerLinear(registry: Registry, options: LinearProviderOptions = {}): void {
  registry.addBundle({ provider: linear(options), toolkits: [linearToolkit] });
}
