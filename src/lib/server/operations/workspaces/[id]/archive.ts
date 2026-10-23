import { getRequestKey } from '@/lib/auth/request-key';
import { workspaceAuthority, executionOperationFailure } from '@/lib/workspaces/access';
import { listChatSessions } from '@/lib/db/queries';
import { stopTeamAiWork } from '@/lib/team/ai/chat';
import { actorFromRequest } from '@/lib/auth/actor';
import { reply, type OperationContext } from '@/lib/server/operation';
import { archiveAgent } from '@/lib/workspaces/archive-agent';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const authority = workspaceAuthority(getRequestKey(request.headers), id, 'configure');
    if (authority) await Promise.all(listChatSessions({ workspaceId: id, includeInternal: true }).map(chat => stopTeamAiWork({ chatId: chat.id }, 'The owner archived this agent.')));
    const row = await archiveAgent(id, actorFromRequest(request.headers));
    if (!row) return reply({ error: 'Workspace not found' }, { status: 404 });
    return reply(row);
  } catch (err) {
    const denied = executionOperationFailure(err);
    if (denied) return denied;
    console.error('[POST /api/workspaces/:id/archive]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
