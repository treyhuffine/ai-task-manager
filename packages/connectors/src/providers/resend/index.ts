import type { Registry } from '../../core/registry';
import { resend } from './provider';
import { resendEmails } from './emails';

export { resend } from './provider';
export { resendEmails } from './emails';

/** Register the Resend provider + toolkit. Connect via `runtime.connectDirect` with an API key. */
export function registerResend(registry: Registry): void {
  registry.addBundle({ provider: resend(), toolkits: [resendEmails] });
}
