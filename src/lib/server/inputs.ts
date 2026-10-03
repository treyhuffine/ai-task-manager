import { EFFORT_LEVELS } from '@/db/types';
import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import type { z as legacyZ } from 'zod';
import { z } from 'zod/v4';

export const chatOverrideSchema = z.object({
  providerId: z.enum(KNOWN_HARNESS_IDS).optional(), model: z.string().optional(),
  variant: z.string().optional(), effort: z.enum(EFFORT_LEVELS).optional(),
}).strict();
export const contentChatSchema = chatOverrideSchema.extend({
  entityType: z.enum(['task', 'note', 'skill', 'skill-try']), entityId: z.string().min(1),
});
export const pathBody = z.object({ path: z.string().min(1) }).strict();
export const fileBody = z.object({ content: z.string() }).strict();
export const renameBody = z.object({ from: z.string().min(1), to: z.string().min(1) }).strict();
export const resolveConflictBody = pathBody.extend({ content: z.string() });

/** Reuse the existing Zod 3 contracts inside a Zod 4 procedure object. Do not
 * insert a Zod 3 object directly into a Zod 4 shape: it erases its input type. */
export function legacySchema<Schema extends legacyZ.ZodTypeAny>(schema: Schema) {
  return z.custom<legacyZ.input<Schema>>().transform((value, ctx): legacyZ.output<Schema> => {
    const parsed = schema.safeParse(value);
    if (parsed.success) return parsed.data;
    for (const issue of parsed.error.issues) ctx.addIssue({ code: 'custom', path: issue.path, message: issue.message });
    return z.NEVER;
  });
}
