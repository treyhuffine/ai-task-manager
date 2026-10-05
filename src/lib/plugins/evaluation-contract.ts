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
  kind: z.literal('public'),
  app: z.enum(['Excalidraw', 'Flint charts', 'Building explorer']),
  view: z.enum(['Diagram', 'Chart', 'Map', 'Table']),
  text: z.string().max(12000),
}).strict();
export const evaluationContextSchema = z.union([scenarioContextSchema, publicViewContextSchema]);
export type EvaluationContext = z.infer<typeof evaluationContextSchema>;

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
}).strict();
