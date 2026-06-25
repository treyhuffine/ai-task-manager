import type { Registry } from '../../core/registry';
import { asana } from './provider';
import { asanaToolkit } from './toolkit';

export { asana } from './provider';
export { asanaToolkit } from './toolkit';

/** Register the Asana provider + toolkit. Connected via `connectDirect` (a personal access token). */
export function registerAsana(registry: Registry): void {
  registry.addBundle({ provider: asana(), toolkits: [asanaToolkit] });
}
