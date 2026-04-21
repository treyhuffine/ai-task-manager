import { z } from 'zod';

export const entitySchema = z.object({
  type: z.enum(['task', 'note', 'area', 'deck']),
  id: z.string(),
  title: z.string().optional(),
  action: z.enum(['created', 'updated', 'completed', 'deleted', 'referenced']),
});

export type McpEntity = z.infer<typeof entitySchema>;

export interface McpInnerStep {
  toolName: string;
  input: unknown;
  output: unknown;
}

export interface McpResponsePayload {
  response: string;
  entities: McpEntity[];
  innerSteps?: McpInnerStep[];
}
