import { z } from 'zod';
import { workResultEffortSchema, workResultHarnessSchema } from '@/lib/work-results/validation';

/** Null and omitted fields inherit. Preferences never enable either home capability. */
export const workspaceReviewPreferencesSchema = z.object({
  reviewBeforeHandoff: z.boolean().nullable().optional(),
  reviewDefaults: z.object({
    harness: workResultHarnessSchema.nullable().optional(),
    model: z.string().trim().min(1).max(160).nullable().optional(),
    variant: z.string().trim().min(1).max(160).nullable().optional(),
    effort: workResultEffortSchema.nullable().optional(),
  }).strict().nullable().optional(),
}).strict();
