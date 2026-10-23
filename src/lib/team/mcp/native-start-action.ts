/** Existing restricted Team launch contract, on the common execution operations. */
import { z } from 'zod';
import { defineAction } from '@/lib/orchestrator/types';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { PERMISSION_MODES, EFFORT_LEVELS } from '@/db/types';
export const nativeTeamExecutionAction = defineAction({
  name: 'start_execution',
  strictParams: true,
  description: 'Start shared work in a Team agent on this Team server. Reuse requestId on retry. Inherits the sending chat permissions.',
  params: {
    workspaceId: z.string().min(1), prompt: z.string().min(1), requestId: z.string().min(1).max(200),
    provider: z.enum(KNOWN_HARNESS_IDS).optional(), model: z.string().min(1).optional(), effort: z.enum(EFFORT_LEVELS).optional(),
    serviceTier: z.string().min(1).nullable().optional(),
    permissionMode: z.enum(PERMISSION_MODES).optional(), taskId: z.string().min(1).optional(), label: z.string().min(1).optional(), deviceId: z.string().min(1).optional(),
  },
  mutating: true, cli: { positional: ['workspaceId'] },
  handler: async (ctx, input) => (await import('@/lib/sessions/team-start-action')).startTeamExecutionAction(ctx, input),
});
