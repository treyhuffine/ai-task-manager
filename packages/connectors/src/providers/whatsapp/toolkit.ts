/**
 * The `whatsapp` toolkit — outbound delivery verbs. Non-OAuth → no action `scopes`. The
 * `phone_number_id` is injected into the path by the provider's auth strategy, so actions only
 * carry the recipient + content.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

interface SendResult {
  messages?: Array<{ id?: string }>;
}

export const whatsappToolkit = defineToolkit({
  id: 'whatsapp',
  providerId: 'whatsapp',
  displayName: 'WhatsApp',
  actions: [
    httpAction({
      id: 'whatsapp.send_message',
      description:
        'Send a free-form text message to a WhatsApp user. Only reaches people who messaged your number in the last 24h; outside that window use send_template.',
      mutating: true,
      risk: 'low',
      input: z.object({
        to: z.string().describe('Recipient phone number in international format, e.g. 15551234567'),
        body: z.string(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/v21.0/messages',
        body: { messaging_product: 'whatsapp', to: i.to, type: 'text', text: { body: i.body, preview_url: false } },
      }),
      output: (raw) => ({ messageId: (raw as SendResult).messages?.[0]?.id }),
    }),

    httpAction({
      id: 'whatsapp.send_template',
      description: 'Send an approved WhatsApp template message (works outside the 24h session window).',
      mutating: true,
      risk: 'low',
      input: z.object({
        to: z.string(),
        name: z.string().describe('Approved template name'),
        languageCode: z.string().default('en_US'),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/v21.0/messages',
        body: {
          messaging_product: 'whatsapp',
          to: i.to,
          type: 'template',
          template: { name: i.name, language: { code: i.languageCode } },
        },
      }),
      output: (raw) => ({ messageId: (raw as SendResult).messages?.[0]?.id }),
    }),
  ],
});
