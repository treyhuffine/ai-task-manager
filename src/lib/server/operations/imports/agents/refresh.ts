import { refreshExternalAgentSessions } from '@/lib/import/external-agents';
import type { ExternalAgentRefreshRequest } from '@/lib/import/types';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body = rpcInput.body as Partial<ExternalAgentRefreshRequest>;
    if (!Array.isArray(body.chatSessionIds)
      || !body.chatSessionIds.every((id) => typeof id === 'string')) {
      return reply({ error: 'chatSessionIds must be an array of strings' }, { status: 400 });
    }
    return reply(await refreshExternalAgentSessions(body.chatSessionIds));
  } catch (error) {
    console.error('[POST /api/imports/agents/refresh]', error);
    return reply(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "chatSessionIds": rpcZ.array(rpcZ.string()).optional() }).strict().default({}) }).strict();
