import { z } from 'zod';
import { TRPCError } from '@trpc/server';
import { viewerProcedure as p, router } from '@/lib/trpc/init';
import { getEmailDraft, transitionEmailDraft, updateEmailDraft } from '@/lib/db/queries';
import { emailAccounts, sendEmailDraft } from './service';
import { emailDraftPatchSchema, EmailDraftError } from './validation';

const identity = z.object({ id: z.string().min(1).max(100), sessionId: z.string().min(1).max(100) }).strict();
const revision = identity.extend({ expectedRevision: z.number().int().nonnegative() });
async function run<T>(operation: () => T | Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof EmailDraftError) throw new TRPCError({ code: error.code === 'not_found' ? 'NOT_FOUND' : error.code === 'conflict' ? 'CONFLICT' : 'BAD_REQUEST', message: error.message });
    throw error;
  }
}
export const emailRouter = router({
  accounts: p.query(() => emailAccounts()),
  get: p.input(identity).query(({ input }) => run(() => getEmailDraft(input.id, input.sessionId))),
  update: p.input(revision.extend({ patch: emailDraftPatchSchema }).strict()).mutation(({ input }) => run(() => updateEmailDraft(input.id, input.sessionId, input.expectedRevision, input.patch))),
  discard: p.input(revision).mutation(({ input }) => run(() => {
    const current = getEmailDraft(input.id, input.sessionId);
    if (current.draft.status === 'discarded') return current;
    return transitionEmailDraft(input.id, input.sessionId, input.expectedRevision, 'draft', { status: 'discarded', error: null });
  })),
  send: p.input(revision).mutation(({ input }) => run(() => sendEmailDraft(input.id, input.sessionId, input.expectedRevision))),
});
