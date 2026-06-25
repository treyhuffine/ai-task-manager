import type { Registry } from '../../core/registry';
import { stripe } from './provider';
import { stripeToolkit } from './toolkit';

export { stripe, stripeForm } from './provider';
export { stripeToolkit } from './toolkit';

/** Register the Stripe provider + toolkit. Connect via `runtime.connectDirect` with a secret key. */
export function registerStripe(registry: Registry): void {
  registry.addBundle({ provider: stripe(), toolkits: [stripeToolkit] });
}
