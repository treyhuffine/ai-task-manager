import { z } from 'zod/v4';
import { getRequestKey } from '@/lib/auth/request-key';
import { getWorkspace } from '@/lib/db/queries';
import { reply, type OperationContext } from '@/lib/server/operation';
import { referencePicker } from '@/lib/sessions/reference-picker';
import { executionCatalogAuthority, workspaceAuthority, executionOperationFailure } from '@/lib/workspaces/access';

/** Search message references before a chat exists, with the selected agent's work first. */
export async function GET(input: z.infer<typeof GETInput>, request: OperationContext) {
  try {
    const key = getRequestKey(request.headers);
    executionCatalogAuthority(key);
    const { workspaceId, limit, ...search } = input.query;
    if (workspaceId) {
      workspaceAuthority(key, workspaceId, 'read');
      if (!getWorkspace(workspaceId)) return reply({ error: 'Agent not found' }, { status: 404 });
    }
    return reply(referencePicker({ ...search, sessionId: null, workspaceId: workspaceId ?? null, limit: limit ? Number(limit) : undefined }));
  } catch (error) {
    const denied = executionOperationFailure(error);
    if (denied) return denied;
    throw error;
  }
}

export const GETInput = z.object({ query: z.object({
  workspaceId: z.string().min(1).optional(),
  q: z.string().max(200).optional(),
  kind: z.enum(['task', 'note']).optional(),
  limit: z.string().regex(/^[1-9]\d{0,2}$/).optional(),
}).strict() }).strict();
