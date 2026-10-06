/**
 * The `mailgun` toolkit — send transactional email. Mailgun's send endpoint is per-domain
 * (`/v3/<domain>/messages`) and form-encoded; `to`/`cc`/`bcc` accept a single address or an array
 * (joined comma-separated, as Mailgun expects). Non-OAuth, so no `scopes`.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

const recipients = z.union([z.string(), z.array(z.string())]);
const join = (r: string | string[]): string => (Array.isArray(r) ? r.join(',') : r);

export const mailgunMessages = defineToolkit({
  id: 'mailgun',
  providerId: 'mailgun',
  displayName: 'Mailgun',
  actions: [
    httpAction({
      id: 'mailgun.send_message',
      description: 'Send a transactional email via Mailgun.',
      mutating: true,
      risk: 'medium',
      input: z.object({
        domain: z.string().describe('Your Mailgun sending domain, e.g. mg.acme.com'),
        from: z.string().describe('Sender, e.g. "Acme <postmaster@mg.acme.com>"'),
        to: recipients,
        subject: z.string(),
        text: z.string().optional(),
        html: z.string().optional(),
        cc: recipients.optional(),
        bcc: recipients.optional(),
      }),
      request: (i) => {
        const form = new URLSearchParams();
        form.set('from', i.from);
        form.set('to', join(i.to));
        form.set('subject', i.subject);
        if (i.text !== undefined) form.set('text', i.text);
        if (i.html !== undefined) form.set('html', i.html);
        if (i.cc !== undefined) form.set('cc', join(i.cc));
        if (i.bcc !== undefined) form.set('bcc', join(i.bcc));
        return {
          method: 'POST',
          path: `/v3/${encodeURIComponent(i.domain)}/messages`,
          rawBody: form.toString(),
          contentType: 'application/x-www-form-urlencoded',
        };
      },
      output: (raw) => {
        const r = raw as { id?: string; message?: string };
        return { id: r.id, message: r.message };
      },
    }),
  ],
});
