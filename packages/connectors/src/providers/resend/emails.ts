/**
 * The `resend` toolkit — send transactional email + look one up. Non-OAuth, so no `scopes`.
 * `to`/`cc`/`bcc` accept a single address or an array; `from` must be a verified Resend domain.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';

const recipients = z.union([z.string(), z.array(z.string())]);

export const resendEmails = defineToolkit({
  id: 'resend',
  providerId: 'resend',
  displayName: 'Resend',
  actions: [
    httpAction({
      id: 'resend.send_email',
      description: 'Send a transactional email via Resend.',
      mutating: true,
      risk: 'medium',
      input: z.object({
        from: z.string().describe('Sender, e.g. "Acme <hi@acme.com>" (a verified Resend domain)'),
        to: recipients,
        subject: z.string(),
        html: z.string().optional(),
        text: z.string().optional(),
        cc: recipients.optional(),
        bcc: recipients.optional(),
        replyTo: z.string().optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/emails',
        body: {
          from: i.from,
          to: i.to,
          subject: i.subject,
          ...(i.html !== undefined ? { html: i.html } : {}),
          ...(i.text !== undefined ? { text: i.text } : {}),
          ...(i.cc !== undefined ? { cc: i.cc } : {}),
          ...(i.bcc !== undefined ? { bcc: i.bcc } : {}),
          ...(i.replyTo !== undefined ? { reply_to: i.replyTo } : {}),
        },
      }),
      output: (raw) => {
        const r = raw as { id?: string };
        return { id: r.id };
      },
    }),

    httpAction({
      id: 'resend.get_email',
      description: 'Get a previously sent email by id.',
      input: z.object({ id: z.string() }),
      request: (i) => ({ method: 'GET', path: `/emails/${encodeURIComponent(i.id)}` }),
      output: (raw) => {
        const r = raw as { id?: string; from?: string; to?: unknown; subject?: string; last_event?: string };
        return { id: r.id, from: r.from, to: r.to, subject: r.subject, last_event: r.last_event };
      },
    }),
  ],
});
