import { getRequestKey } from '@/lib/auth/request-key';
import { sessionAuthority, executionOperationFailure } from '@/lib/workspaces/access';
import { getChatSessionWithExecution, chatPlacement } from '@/lib/db/queries';
import { chatSkillCommands } from '@/lib/skills/commands';
import { sessionSkillPlan } from '@/lib/skills/exclusions';
import * as executor from '@/lib/executor/adapter';
import { reply, type OperationContext } from '@/lib/server/operation';
import { z as rpcZ } from 'zod/v4';

/** Discover from the chat's working folder and attached skills, then apply its live inventory. */
export async function GET(rpcInput: rpcZ.infer<typeof GETInput>, request: OperationContext) {
  try {
    const { id } = rpcInput.params;
    const authority = sessionAuthority(getRequestKey(request.headers), id, 'read');

    const session = getChatSessionWithExecution(id);
    if (!session) {
      return reply({ error: 'session not found' }, { status: 404 });
    }

    if (authority || chatPlacement(id)?.isHome === false) return reply({ commands: [], diagnostics: [], inventorySource: 'none' });
    const cwd = executor.resolveCwd(session);
    if (!cwd) return reply({ commands: [], diagnostics: [], inventorySource: 'none' });
    return reply(await chatSkillCommands({
      cwd,
      harness: session.harness,
      inventory: executor.getSessionInventory(id),
      skillPlan: sessionSkillPlan(session),
    }));
  } catch (error) {
    const denied = executionOperationFailure(error);
    if (denied) return denied;
    throw error;
  }
}

export const GETInput = rpcZ.object({ params: rpcZ.object({ "id": rpcZ.string().min(1) }).strict() }).strict();
