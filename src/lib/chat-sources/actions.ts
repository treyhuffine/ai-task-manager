import { z } from 'zod';
import { ActionError, defineAction, type ActionContext } from '@/lib/orchestrator/types';
import { SESSION_CREDENTIAL_ENV, SESSION_CREDENTIAL_HEADER } from '@/lib/orchestrator/session-credential';
import { serverFetch } from '@/lib/orchestrator/server-client';
import { SourceError } from './service';

const binding = { message_id: z.string().uuid(), source_ref: z.string().min(1).max(2731) };
export const describeSourceParams = { ...binding, action: z.string().min(1).max(256).optional(), cursor: z.number().int().min(0).max(10000).optional() };
export const callSourceParams = { ...binding, action: z.string().min(1).max(256), input: z.record(z.unknown()), invocation_id: z.string().uuid() };
export async function dispatchSourceAction(ctx: ActionContext, operation: string, value: unknown, signal?: AbortSignal) {
  if (ctx.remote === false) return serverFetch('/chat-sources/action', { method: 'POST', body: JSON.stringify({ operation, input: value }), headers: { [SESSION_CREDENTIAL_HEADER]: process.env[SESSION_CREDENTIAL_ENV] ?? '' } });
  const { chatSources } = await import('@/lib/server/chat-sources');
  try {
    if (operation === 'describe') {
      const input = z.object(describeSourceParams).strict().parse(value);
      return await chatSources.describe(ctx.actor?.sessionId, input.message_id, input.source_ref, input.action, input.cursor);
    }
    if (operation === 'call') {
      const input = z.object(callSourceParams).strict().parse(value);
      return await chatSources.call(ctx.actor?.sessionId, input.message_id, input.source_ref, input.action, input.input, input.invocation_id, signal);
    }
    throw new ActionError('invalid_params', 'Unknown source operation');
  } catch (error) {
    if (error instanceof SourceError) throw new ActionError(error.code === 'invalid_reference' ? 'invalid_params' : 'unsupported', error.message, undefined, { code: error.code });
    throw error;
  }
}
export const chatSourceActions = [
  defineAction({ name: 'describe_chat_source', description: 'Describe an app or exact account mentioned in a user message in this chat. Use action for one full schema, or cursor to page actions. References do not grant access.', params: describeSourceParams, handler: (ctx, input) => dispatchSourceAction(ctx, 'describe', input) }),
  defineAction({ name: 'call_chat_source', description: 'Call an authorized action through a user-mentioned app or exact account. Keep invocation_id unchanged when retrying the same operation. Approval pauses require waiting for the user, then retrying. A new intended operation needs a new invocation_id.', params: callSourceParams, handler: (ctx, input) => dispatchSourceAction(ctx, 'call', input) }),
];
