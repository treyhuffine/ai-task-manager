import { reorderWorkspaces } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

export async function POST(rpcInput: rpcZ.infer<typeof POSTInput>, _request: OperationContext) {
  try {
    const body: { ids?: unknown } = rpcInput.body;
    if (!Array.isArray(body.ids) || !body.ids.every((x) => typeof x === 'string')) {
      return reply({ error: 'ids must be an array of strings' }, { status: 400 });
    }
    reorderWorkspaces(body.ids as string[]);
    return reply({ ok: true });
  } catch (err) {
    console.error('[POST /api/workspaces/reorder]', err);
    return reply({ error: String(err) }, { status: 400 });
  }
}

export const POSTInput = rpcZ.object({ body: rpcZ.object({ "ids": rpcZ.array(rpcZ.string()).optional() }).strict().default({}) }).strict();
