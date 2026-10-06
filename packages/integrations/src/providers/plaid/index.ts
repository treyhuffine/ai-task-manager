import type { Registry } from '../../core/registry';
import { plaid } from './provider';
import type { PlaidProviderOptions } from './provider';
import { plaidToolkit } from './toolkit';

export { plaid } from './provider';
export type { PlaidProviderOptions } from './provider';
export { plaidToolkit } from './toolkit';

/** Register the Plaid provider + toolkit. Connect via `runtime.connectDirect` with a custom credential ({ client_id, secret }). */
export function registerPlaid(registry: Registry, options: PlaidProviderOptions = {}): void {
  registry.addBundle({ provider: plaid(options), toolkits: [plaidToolkit] });
}
