/**
 * Zod schemas for the stream triage wire surface — the single source shared
 * by orchestrator actions (registry.ts) and API routes so drafts and
 * proposals validate identically everywhere. Deeper invariants (dates
 * require evidence, merge targets must exist) are enforced again in the
 * query layer; this is the shape gate.
 */

import { z } from 'zod';

export const triageDispositionSchema = z.enum([
  'promote_task',
  'promote_note',
  'merge_task',
  'merge_note',
  'combine_task',
  'combine_note',
  'journal',
  'dismiss',
  'incubate',
]);

export const triageEnergySchema = z.enum(['deep', 'light']);
export const triageEffortSchema = z.enum(['trivial', 'small', 'medium', 'large', 'epic']);

/** Raw shape (not z.object) so the action generators can wrap it. */
export const triageDraftShape = {
  title: z.string().optional(),
  body: z.string().optional(),
  description: z.string().optional(),
  // Task promotion: park as a possibility (consider) or commit (todo, default).
  status: z.enum(['consider', 'todo']).optional(),
  areaId: z.string().nullable().optional(),
  parentId: z.string().nullable().optional(),
  taskId: z.string().nullable().optional(),
  energy: triageEnergySchema.nullable().optional(),
  effort: triageEffortSchema.nullable().optional(),
  hardDeadline: z.string().nullable().optional(),
  reminderAt: z.string().nullable().optional(),
  evidence: z.string().optional(),
  expectedTargetUpdatedAt: z.string().optional(),
  resurfaceAt: z.string().optional(),
  asSubtask: z.boolean().optional(),
};

export const triageDraftSchema = z.object(triageDraftShape).strict();

export const triageProposalSchema = z
  .object({
    disposition: triageDispositionSchema,
    stream_item_ids: z.array(z.string().min(1)).min(1),
    target_type: z.enum(['task', 'note']).nullable().optional(),
    target_id: z.string().nullable().optional(),
    draft: triageDraftSchema.nullable().optional(),
    rationale: z.string().min(1),
    confidence: z.number().min(0).max(1).optional(),
  })
  .strict();

export type TriageProposalWire = z.infer<typeof triageProposalSchema>;
