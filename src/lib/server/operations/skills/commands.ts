import { z } from 'zod/v4';
import { getRequestKey } from '@/lib/auth/request-key';
import { getAppRoot } from '@/lib/config/paths';
import { getWorkspace } from '@/lib/db/queries';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { reply, type OperationContext } from '@/lib/server/operation';
import { chatSkillCommands } from '@/lib/skills/commands';
import { authorizeSkillOperation } from '@/lib/skills/home-policy';
import { workspaceAuthority, executionOperationFailure } from '@/lib/workspaces/access';

/** Skill suggestions for New chat, before a session or worktree exists. */
export async function GET(input: z.infer<typeof GETInput>, request: OperationContext) {
  try {
    const member = authorizeSkillOperation(request.headers);
    if (input.query.workspaceId) workspaceAuthority(getRequestKey(request.headers), input.query.workspaceId, 'read');
    // Shared chats never discover the host computer's private skill folders.
    if (member) return reply({ commands: [], diagnostics: [], inventorySource: 'none' });
    const workspace = input.query.workspaceId ? getWorkspace(input.query.workspaceId) : null;
    if (input.query.workspaceId && !workspace) return reply({ error: 'agent not found' }, { status: 404 });
    return reply(await chatSkillCommands({ cwd: workspace?.cwd ?? getAppRoot(), harness: input.query.harness }));
  } catch (error) {
    const denied = executionOperationFailure(error);
    if (denied) return denied;
    throw error;
  }
}

export const GETInput = z.object({ query: z.object({
  workspaceId: z.string().min(1).optional(),
  harness: z.enum(KNOWN_HARNESS_IDS),
}).strict() }).strict();
