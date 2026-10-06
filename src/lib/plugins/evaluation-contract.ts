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
  update: z.object({ version: z.number().int().nonnegative() }).strict().optional(),
  operation: z.object({ toolName: z.string().min(1).max(200) }).strict().optional(),
  diagram: z.object({ checkpointId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/), version: z.number().int().nonnegative() }).strict().optional(),
}).strict().refine(value => !value.diagram || value.kind === 'public' && value.app === 'Excalidraw' && value.view === 'Diagram', 'Only the public Excalidraw diagram supports this update capability').refine(value => !value.update || value.kind === 'public' && ['Flint charts', 'Building explorer', 'tldraw'].includes(value.app), 'This public update belongs to a different app').refine(value => !value.operation || value.kind === 'account' && ['Asana', 'Figma', 'PostHog'].includes(value.app), 'Account operations require an account result');
export const evaluationContextSchema = z.union([scenarioContextSchema, publicViewContextSchema]);
export type EvaluationContext = z.infer<typeof evaluationContextSchema>;
export function allowsEvaluationChanges(context: EvaluationContext) {
  return 'inputs' in context || context.kind === 'public' && context.app === 'Excalidraw' && context.view === 'Diagram' && !!context.diagram || 'kind' in context && (!!context.update || !!context.operation);
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
  status: z.enum(['ready', 'unknown', 'unused', 'approval']),
  inputs: scenarioInputsSchema.optional(),
  view: z.object({ invocationId: z.uuid() }).strict().optional(),
  ticket: z.uuid().optional(),
  toolName: z.string().max(200).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(),
  approvalIds: z.array(z.string().max(200)).max(16).optional(),
  diagram: z.object({ invocationId: z.uuid(), checkpointId: z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/) }).strict().optional(),
}).strict();

export const accountRpcSchema = z.object({
  handle: z.uuid(), method: z.enum(['initialize', 'tools/list', 'resources/list', 'resources/read', 'tools/call']),
  invocationId: z.uuid().optional(), name: z.string().max(200).optional(), uri: z.string().max(1000).optional(),
  arguments: z.record(z.string(), z.unknown()).optional(), audience: z.enum(['model', 'app']).default('app'),
  retryApproval: z.boolean().optional(),
}).strict();
