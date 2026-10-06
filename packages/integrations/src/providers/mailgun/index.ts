import type { Registry } from '../../core/registry';
import { mailgun } from './provider';
import type { MailgunProviderOptions } from './provider';
import { mailgunMessages } from './messages';

export { mailgun } from './provider';
export type { MailgunProviderOptions } from './provider';
export { mailgunMessages } from './messages';

/** Register the Mailgun provider + toolkit. Connect via `runtime.connectDirect` with an API key. */
export function registerMailgun(registry: Registry, options: MailgunProviderOptions = {}): void {
  registry.addBundle({ provider: mailgun(options), toolkits: [mailgunMessages] });
}
