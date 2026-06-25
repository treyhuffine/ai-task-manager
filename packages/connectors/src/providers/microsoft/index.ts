import type { Registry } from '../../core/registry';
import { microsoft, MICROSOFT_SCOPES } from './provider';
import type { MicrosoftProviderOptions } from './provider';
import { outlookMail } from './mail';
import { outlookCalendar } from './calendar';

export { microsoft, MICROSOFT_SCOPES } from './provider';
export type { MicrosoftProviderOptions } from './provider';
export { outlookMail } from './mail';
export { outlookCalendar } from './calendar';

/** Register the Microsoft 365 provider with its Outlook Mail + Calendar toolkits. */
export function registerMicrosoft(registry: Registry, options: MicrosoftProviderOptions = {}): void {
  registry.addBundle({ provider: microsoft(options), toolkits: [outlookMail, outlookCalendar] });
}
