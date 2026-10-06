import type { Registry } from '../../core/registry';
import { zendesk } from './provider';
import { zendeskToolkit } from './toolkit';

export { zendesk } from './provider';
export { zendeskToolkit } from './toolkit';

/** Register the Zendesk provider + toolkit. Connected via `connectDirect` (subdomain/email/api_token). */
export function registerZendesk(registry: Registry): void {
  registry.addBundle({ provider: zendesk(), toolkits: [zendeskToolkit] });
}
