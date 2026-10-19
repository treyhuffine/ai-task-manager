import { z } from 'zod';
import { defineAction, ActionError, type ActionContext } from './types';
import { getChatSession, createEmailDraft, getEmailDraft, updateEmailDraft } from '@/lib/db/queries';
import { emailDraftPatchSchema, EmailDraftError } from '@/lib/email/validation';
import { serverFetch, ServerResponseError } from './server-client';
import { sessionCredential, SESSION_CREDENTIAL_HEADER } from './session-credential';

const create = { request_id: z.string().min(1).max(200), ...emailDraftPatchSchema.shape };
const get = { id: z.string().min(1).max(100) };
const update = { ...get, expected_revision: z.number().int().nonnegative(), patch: emailDraftPatchSchema };
const schemas = { create: z.object(create).strict(), get: z.object(get).strict(), update: z.object(update).strict(), accounts: z.object({}).strict() };

/** The chat identity comes only from the signed caller, never an input session id. */
export async function dispatchEmailOperation(context: ActionContext, operation: keyof typeof schemas, input: unknown): Promise<unknown> {
  const sessionId = context.actor?.sessionId;
  const session = sessionId ? getChatSession(sessionId) : null;
  if (!sessionId || !session || session.userId !== 'local' || session.surfaceKind === 'result_review') throw new ActionError('unsupported', 'Email drafts require a signed Ri chat');
  if (!context.remote) {
    const credential = sessionCredential(sessionId);
    try {
      return await serverFetch('/email/action', { method: 'POST', headers: credential ? { [SESSION_CREDENTIAL_HEADER]: credential } : {}, body: JSON.stringify({ operation, input }) });
    } catch (error) {
      if (error instanceof ServerResponseError) {
        const body = error.json();
        const code = body?.code;
        if (code === 'not_found' || code === 'conflict' || code === 'invalid_params' || code === 'unsupported') throw new ActionError(code, typeof body?.error === 'string' ? body.error : error.message);
      }
      throw error;
    }
  }
  try {
    switch (operation) {
      case 'create': {
        const { request_id, ...fields } = schemas.create.parse(input);
        return createEmailDraft(sessionId, request_id, fields);
      }
      case 'get': return getEmailDraft(schemas.get.parse(input).id, sessionId);
      case 'update': {
        const value = schemas.update.parse(input);
        return updateEmailDraft(value.id, sessionId, value.expected_revision, value.patch);
      }
      case 'accounts': {
        schemas.accounts.parse(input);
        // Keep the Connector runtime out of the CLI's static import graph.
        const { emailAccounts } = await import('@/lib/email/service');
        const { resolveWorkspaceIntegrationFilter } = await import('@/lib/integrations/runtime');
        const accounts = await emailAccounts();
        if (!session.workspaceId) return session.type === 'orchestration' || session.type === 'content' ? accounts : [];
        const filter = await resolveWorkspaceIntegrationFilter(session.workspaceId);
        return accounts.filter(account => {
          const toolkit = account.provider === 'google' ? 'gmail' : 'outlook_mail';
          if (!filter.toolkits.includes(toolkit)) return false;
          const pin = filter.connectionPins[toolkit];
          const allowed = filter.allowedAccounts[toolkit];
          return pin ? pin === account.id : allowed ? allowed.some(item => item.connectionId === account.id) : true;
        });
      }
    }
  } catch (error) {
    if (error instanceof EmailDraftError) throw new ActionError(error.code, error.message);
    throw error;
  }
}

export const emailActions = [
  defineAction({ name: 'create_email_draft', description: 'Open an editable email composer inline in this chat. Use whenever the user wants to draft or send email. Fill any known To, Cc, Bcc, subject and plain-text body. Recipients are comma-separated email addresses. Unknown fields may be omitted. The user can select a sending account and send from the card. Creating a draft never sends. Reuse request_id for identical retries.', params: create, mutating: true, handler: (ctx, input) => dispatchEmailOperation(ctx, 'create', input) }),
  defineAction({ name: 'get_email_draft', description: 'Read an email draft in this signed chat, including the latest human edits, revision and sending status. Read before revising it.', params: get, handler: (ctx, input) => dispatchEmailOperation(ctx, 'get', input) }),
  defineAction({ name: 'update_email_draft', description: 'Partially fill or revise this chat’s existing email composer. Pass the revision from get_email_draft as expected_revision. A conflict means the human or another caller edited it. Read again and preserve their changes. Only provided fields change. Never sends email.', params: update, mutating: true, handler: (ctx, input) => dispatchEmailOperation(ctx, 'update', input) }),
  defineAction({ name: 'list_email_accounts', description: 'List available Gmail and Outlook sending accounts within this agent’s authorized account scope. A draft may omit connectionId so the user chooses in its composer.', params: {}, handler: ctx => dispatchEmailOperation(ctx, 'accounts', {}) }),
] as const;
