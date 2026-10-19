import { describe, expect, it, vi } from 'vitest';
import { outlookMail } from '../providers/microsoft/mail';
import type { ActionContext } from '../core/types';

describe('Outlook mail composition', () => {
  it('sends To, Cc and Bcc to Graph and saves the sent message', async () => {
    const action = outlookMail.actions.find(action => action.id === 'outlook_mail.send_mail')!;
    const input = action.input.parse({ to: ['to@example.com'], cc: ['cc@example.com'], bcc: ['private@example.com'], subject: 'Meeting', content: 'Hello\nWorld' });
    const request = vi.fn().mockResolvedValue(undefined);
    const ctx = { http: { request }, config: {} } as unknown as ActionContext;
    expect(await action.execute(ctx, input)).toEqual({ sent: true });
    expect(request).toHaveBeenCalledWith(expect.objectContaining({ method: 'POST', path: '/me/sendMail', body: {
      message: { subject: 'Meeting', body: { contentType: 'Text', content: 'Hello\nWorld' }, toRecipients: [{ emailAddress: { address: 'to@example.com' } }], ccRecipients: [{ emailAddress: { address: 'cc@example.com' } }], bccRecipients: [{ emailAddress: { address: 'private@example.com' } }] },
      saveToSentItems: true,
    } }));
    expect(action.input.safeParse({ to: ['to@example.com'], bcc: ['bad address'], subject: 'Meeting', content: 'Hello' }).success).toBe(false);
  });
});
