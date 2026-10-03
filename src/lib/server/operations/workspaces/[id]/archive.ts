import { actorFromRequest } from '@/lib/auth/actor';
import { reply, type OperationContext } from '@/lib/server/operation';
import { archiveAgent } from '@/lib/workspaces/archive-agent';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const row = await archiveAgent(id, actorFromRequest(request.headers));
    if (!row) return reply({ error: 'Workspace not found' }, { status: 404 });
    return reply(row);
  } catch (err) {
    console.error('[POST /api/workspaces/:id/archive]', err);
    return reply({ error: String(err) }, { status: 500 });
  }
}

export const POSTInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict(), body: rpcZ.object({}).strict().default({}) }).strict();
