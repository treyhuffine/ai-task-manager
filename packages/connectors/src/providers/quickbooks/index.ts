import type { Registry } from '../../core/registry';
import { quickbooks } from './provider';
import type { QuickbooksProviderOptions } from './provider';
import { quickbooksToolkit } from './toolkit';

export { quickbooks } from './provider';
export type { QuickbooksProviderOptions } from './provider';
export { quickbooksToolkit } from './toolkit';

/** Register the QuickBooks provider with its toolkit in one call. */
export function registerQuickbooks(registry: Registry, options: QuickbooksProviderOptions = {}): void {
  registry.addBundle({ provider: quickbooks(options), toolkits: [quickbooksToolkit] });
}
