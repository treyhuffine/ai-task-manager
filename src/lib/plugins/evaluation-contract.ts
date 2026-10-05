import { z } from 'zod/v4';

export const scenarioInputsSchema = z.object({
  startingMRR: z.number().min(10000).max(500000),
  monthlyGrowthRate: z.number().min(0).max(20),
  monthlyChurnRate: z.number().min(0).max(15),
  grossMargin: z.number().min(50).max(95),
  fixedCosts: z.number().min(5000).max(200000),
}).strict();

export const scenarioContextSchema = z.object({
  invocationId: z.uuid(),
  revision: z.number().int().nonnegative(),
  inputs: scenarioInputsSchema,
}).strict();
export type ScenarioContext = z.infer<typeof scenarioContextSchema>;

export const publicViewContextSchema = z.object({
  invocationId: z.uuid(),
  revision: z.number().int().nonnegative(),
  kind: z.enum(['public', 'account']),
  app: z.enum(['Excalidraw', 'Flint charts', 'Building explorer', 'tldraw', 'Asana', 'Figma', 'PostHog']),
  view: z.enum(['Diagram', 'Chart', 'Map', 'Table', 'Canvas', 'Tasks', 'Query']),
  text: z.string().max(12000),
  diagram: z.object({ checkpointId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), version: z.number().int().nonnegative() }).strict().optional(),
}).strict().refine(value => !value.diagram || value.kind === 'public' && value.app === 'Excalidraw' && value.view === 'Diagram', 'Only the public Excalidraw diagram supports this update capability');
export const evaluationContextSchema = z.union([scenarioContextSchema, publicViewContextSchema]);
export type EvaluationContext = z.infer<typeof evaluationContextSchema>;
export function allowsEvaluationChanges(context: EvaluationContext) {
  return 'inputs' in context || context.kind === 'public' && context.app === 'Excalidraw' && context.view === 'Diagram' && !!context.diagram;
}

export const evaluationChatInputSchema = z.object({
  parentOrigin: z.string().url(),
  viewUrl: z.string().url(),
  turnId: z.uuid(),
  message: z.string().trim().min(1).max(2000),
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), text: z.string().max(4000) }).strict()).max(12),
  context: evaluationContextSchema,
  allowChanges: z.boolean(),
}).strict();

export const evaluationToolResultSchema = z.object({
  status: z.enum(['ready', 'unknown', 'unused']),
  inputs: scenarioInputsSchema.optional(),
  diagram: z.object({ invocationId: z.uuid(), checkpointId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict().optional(),
}).strict();

export const accountRpcSchema = z.object({
  handle: z.uuid(), method: z.enum(['initialize', 'tools/list', 'resources/list', 'resources/read', 'tools/call']),
  invocationId: z.uuid().optional(), name: z.string().max(200).optional(), uri: z.string().max(1000).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(), audience: z.enum(['model', 'app']).default('app'),
  retryApproval: z.boolean().optional(),
}).strict();
