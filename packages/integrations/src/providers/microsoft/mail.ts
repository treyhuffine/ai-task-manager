/**
 * The `outlook_mail` toolkit (Microsoft Graph). Reads need `Mail.Read`; sending needs the
 * narrower `Mail.Send`. Shares the one Microsoft connection with the calendar toolkit.
 */
import { z } from 'zod';
import { defineToolkit, httpAction } from '../../core/authoring';
import { MICROSOFT_SCOPES } from './provider';

interface RawMessage {
  id?: string;
  subject?: string;
  from?: { emailAddress?: { address?: string; name?: string } };
  receivedDateTime?: string;
  bodyPreview?: string;
  body?: { contentType?: string; content?: string };
}

function messageSummary(m: RawMessage) {
  return {
    id: m.id,
    subject: m.subject,
    from: m.from?.emailAddress?.address,
    receivedDateTime: m.receivedDateTime,
    preview: m.bodyPreview,
  };
}

export const outlookMail = defineToolkit({
  id: 'outlook_mail',
  providerId: 'microsoft',
  displayName: 'Outlook Mail',
  actions: [
    httpAction({
      id: 'outlook_mail.list_messages',
      description: 'List or search Outlook messages (most recent first). Use `search` for free-text.',
      scopes: [MICROSOFT_SCOPES.mailRead],
      input: z.object({
        top: z.number().int().positive().max(100).default(25),
        search: z.string().optional().describe('Free-text search over the mailbox'),
      }),
      request: (i) => ({
        method: 'GET',
        path: '/me/messages',
        query: {
          $top: i.top,
          $search: i.search ? `"${i.search}"` : undefined,
          $select: 'id,subject,from,receivedDateTime,bodyPreview',
          $orderby: i.search ? undefined : 'receivedDateTime desc',
        },
      }),
      output: (raw) => {
        const r = raw as { value?: RawMessage[] };
        return { messages: (r.value ?? []).map(messageSummary) };
      },
    }),

    httpAction({
      id: 'outlook_mail.get_message',
      description: 'Get a single Outlook message (with its body) by id.',
      scopes: [MICROSOFT_SCOPES.mailRead],
      input: z.object({ messageId: z.string() }),
      request: (i) => ({ method: 'GET', path: `/me/messages/${encodeURIComponent(i.messageId)}` }),
      output: (raw) => {
        const m = raw as RawMessage;
        return { ...messageSummary(m), body: m.body?.content };
      },
    }),

    httpAction({
      id: 'outlook_mail.send_mail',
      description: 'Send an email from the connected Outlook account.',
      mutating: true,
      risk: 'high',
      scopes: [MICROSOFT_SCOPES.mailSend],
      input: z.object({
        to: z.array(z.string().email()).min(1),
        subject: z.string(),
        content: z.string(),
        cc: z.array(z.string().email()).optional(),
      }),
      request: (i) => ({
        method: 'POST',
        path: '/me/sendMail',
        body: {
          message: {
            subject: i.subject,
            body: { contentType: 'Text', content: i.content },
            toRecipients: i.to.map((address) => ({ emailAddress: { address } })),
            ...(i.cc ? { ccRecipients: i.cc.map((address) => ({ emailAddress: { address } })) } : {}),
          },
          saveToSentItems: true,
        },
      }),
      // sendMail returns 202 with no body.
      output: () => ({ sent: true }),
    }),
  ],
});
