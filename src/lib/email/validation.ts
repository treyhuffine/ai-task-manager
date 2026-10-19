import { z } from 'zod';
import type { EmailDraft } from '@/db/types';

const header = z.string().max(2000).refine(value => !/[\r\n]/.test(value), 'Use a single line');
export const emailDraftFieldsSchema = z.object({
  connectionId: z.string().min(1).max(300).nullable(),
  to: header,
  cc: header,
  bcc: header,
  subject: header,
  body: z.string().max(200_000),
}).strict();
export type EmailDraftFields = z.infer<typeof emailDraftFieldsSchema>;
export const emailDraftPatchSchema = emailDraftFieldsSchema.partial();
export const emailDraftSchema: z.ZodType<EmailDraft> = emailDraftFieldsSchema.extend({
  version: z.literal(1),
  revision: z.number().int().nonnegative(),
  status: z.enum(['draft', 'sending', 'sent', 'uncertain', 'discarded']),
  error: z.string().nullable(),
  sentAt: z.string().nullable(),
  fromLabel: z.string().nullable(),
  messageId: z.string().nullable(),
}).strict();

export function parseEmailDraft(content: string | null): EmailDraft | null {
  try {
    const result = emailDraftSchema.safeParse(JSON.parse(content ?? ''));
    return result.success ? result.data : null;
  } catch { return null; }
}

export function emailRecipients(value: string): string[] {
  return value.split(',').map(address => address.trim()).filter(Boolean);
}

/** Incomplete recipients can be saved while typing. Only a send requires valid addresses. */
export function emailSendProblem(draft: EmailDraftFields): string | null {
  if (!draft.connectionId) return 'Choose a sending account';
  if (!emailRecipients(draft.to).length) return 'Add a recipient';
  for (const field of ['to', 'cc', 'bcc'] as const) {
    if (/[\r\n]/.test(draft[field]) || emailRecipients(draft[field]).some(address => !z.string().email().safeParse(address).success)) {
      return `Check the email addresses in ${field === 'to' ? 'To' : field === 'cc' ? 'Cc' : 'Bcc'}`;
    }
  }
  if (!draft.subject.trim()) return 'Add a subject';
  if (/[\r\n]/.test(draft.subject)) return 'Use a single line for the subject';
  if (!draft.body.trim()) return 'Write a message';
  return null;
}

export class EmailDraftError extends Error {
  constructor(public code: 'not_found' | 'conflict' | 'invalid_params' | 'unsupported', message: string) {
    super(message);
    this.name = 'EmailDraftError';
  }
}
