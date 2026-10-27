import { z } from 'zod/v4';
import { AI_CLIENT_NAME_MAX } from '@/lib/db/queries';
import { AI_CLIENTS, type AiClientKind } from './client-config';

export const clientKind = z.enum(AI_CLIENTS.map(client => client.kind) as [AiClientKind, ...AiClientKind[]]);

/** A key for one outside agent, personal or a team member's. Its name defaults to the agent's. */
export const aiClientKeyInput = z.object({
  client: clientKind.default('other'),
  name: z.string().trim().min(1).max(AI_CLIENT_NAME_MAX).optional(),
}).strict();
