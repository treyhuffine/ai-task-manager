import type { Registry } from '../../core/registry';
import { whatsapp } from './provider';
import { whatsappToolkit } from './toolkit';

export { whatsapp } from './provider';
export { whatsappToolkit } from './toolkit';

/** Register the WhatsApp Business provider + toolkit. Connected via `connectDirect` (access_token + phone_number_id). */
export function registerWhatsapp(registry: Registry): void {
  registry.addBundle({ provider: whatsapp(), toolkits: [whatsappToolkit] });
}
