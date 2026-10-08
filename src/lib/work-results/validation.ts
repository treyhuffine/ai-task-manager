import { KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
import { z } from 'zod';

/** Markdown indentation and line breaks are content, including on human Save. */
export const workResultBodySchema = z.string().refine((value) => value.trim().length > 0, 'A nonempty Markdown body is required');

export const workResultAttachmentSchema = z.object({
  fileName: z.string().min(1), originalName: z.string().min(1), mimeType: z.string().min(1),
  size: z.number().int().positive().max(50 * 1024 * 1024), uploadedAt: z.string().min(1),
}).strict();

export const workResultLinkSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), label: z.string().trim().min(1), url: z.string().url().refine((value) => ['http:', 'https:'].includes(new URL(value).protocol), 'Only HTTP(S) links are supported') }).strict(),
  z.object({ kind: z.literal('preview'), label: z.string().trim().min(1), previewTargetId: z.string().min(1) }).strict(),
]);

export const workResultCodeRevisionSchema = z.object({
  commitSha: z.string().nullable(), workingTreeState: z.enum(['clean', 'dirty', 'unknown']),
  capturedAt: z.string().min(1), checkpointRef: z.string().optional(),
}).strict();
const storedAttachmentSchema = z.object({
  file_name: z.string().min(1), original_name: z.string().min(1), mime_type: z.string().min(1),
  size: z.number().int().positive().max(50 * 1024 * 1024), uploaded_at: z.string().min(1),
}).strict();
const scopeObservation = {
  codeRevision: workResultCodeRevisionSchema.nullable().optional(), repository: z.string().nullable().optional(),
  baseSha: z.string().nullable().optional(), capturedAt: z.string().optional(), limitations: z.array(z.string()).optional(),
};
export const workResultReviewScopeSchema = z.object({
  requested: z.object({ ...scopeObservation, resultId: z.string().min(1), attachments: z.array(storedAttachmentSchema), capturedAt: z.string().min(1) }).strict(),
  observed: z.object({ ...scopeObservation, attachments: z.array(storedAttachmentSchema).optional(), drift: z.boolean().nullable().optional() }).strict().optional(),
}).strict();
export const workResultEffortSchema = z.enum(['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
export const workResultHarnessSchema = z.enum(KNOWN_HARNESS_IDS);
export const workResultReviewProvenanceSchema = z.object({
  method: z.enum(['native_review', 'fresh_session', 'reported_review']), independence: z.enum(['observed', 'reported', 'unknown']),
  observedHarness: workResultHarnessSchema.nullable().optional(), observedModel: z.string().nullable().optional(),
  observedEffort: workResultEffortSchema.nullable().optional(), nativeReviewId: z.string().nullable().optional(),
  limitations: z.array(z.string()).optional(),
}).strict();
export const reviewContentSchema = z.object({
  body: workResultBodySchema, title: z.string().optional(), attachments: z.array(workResultAttachmentSchema).optional(),
  links: z.array(workResultLinkSchema).optional(), scope: workResultReviewScopeSchema, provenance: workResultReviewProvenanceSchema,
}).strict();

export const saveWorkResultSchema = z.object({
  requestId: z.string().min(1).max(200), body: workResultBodySchema, title: z.string().optional(),
  attachments: z.array(workResultAttachmentSchema).optional(), links: z.array(workResultLinkSchema).optional(), attention: z.string().optional(),
  taskIds: z.array(z.string().min(1)).optional(), supersedesId: z.string().optional(),
  sourceChatSessionId: z.string().optional(), sourceEventId: z.string().optional(),
}).strict();
export const reviewSelectionShape = {
  harness: workResultHarnessSchema.optional(), model: z.string().min(1).optional(), variant: z.string().min(1).nullable().optional(), effort: workResultEffortSchema.nullable().optional(),
};
export const requestAiReviewSchema = z.object({
  requestId: z.string().min(1).max(200), focus: z.string().optional(), ...reviewSelectionShape, rerun: z.boolean().optional(),
}).strict();
export const workResultDecisionSchema = z.object({
  requestId: z.string().min(1).max(200), disposition: z.enum(['accepted', 'changes_requested', 'dismissed']), note: z.string().optional(),
  context: z.object({ reviewId: z.string().optional(), attachmentFileName: z.string().optional(), previewTargetId: z.string().optional() }).strict().optional(),
  attachments: z.array(workResultAttachmentSchema).optional(),
}).strict();
export const prepareWorkResultSchema = z.object({
  requestId: z.string().min(1).max(200), sourceChatSessionId: z.string().min(1), sourceEventId: z.string().optional(), resultId: z.string().optional(),
}).strict();
