import { z } from 'zod/v4';
import type { Attachment } from '@/db/types';

export const MAX_FEEDBACK_FILES = 5;
export const MAX_FEEDBACK_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FEEDBACK_TOTAL_BYTES = 20 * 1024 * 1024;
export const MAX_FEEDBACK_MESSAGE = 10_000;
export const GITHUB_ISSUES_NEW_URL = 'https://github.com/dynamismlabs/ri/issues/new';
export const FeedbackKindSchema = z.enum(['feedback', 'bug', 'question']);
export type FeedbackKind = z.infer<typeof FeedbackKindSchema>;

export const FeedbackAttachmentSchema = z.object({
  fileName: z.string().regex(/^[a-f0-9-]{36}\.[a-z0-9]+$/i),
  originalName: z.string().min(1).max(512),
  mimeType: z.string().min(1).max(256),
  size: z.number().int().nonnegative().max(MAX_FEEDBACK_FILE_BYTES),
  uploadedAt: z.string().min(1).max(64),
}) satisfies z.ZodType<Attachment>;

export const FeedbackDiagnosticsSchema = z.object({
  view: z.string().max(64).optional(),
  viewport: z.enum(['phone', 'tablet', 'desktop']).nullable().optional(),
  theme: z.enum(['light', 'dark']).optional(),
  surface: z.enum(['desktop', 'web']).optional(),
  homeKind: z.enum(['personal', 'team']).optional(),
  userAgent: z.string().max(512).optional(),
});

export const FeedbackInputSchema = z
  .object({
    kind: FeedbackKindSchema,
    message: z
      .string()
      .trim()
      .min(1, 'Please add a short note before continuing.')
      .max(MAX_FEEDBACK_MESSAGE),
    includeDiagnostics: z.boolean().default(true),
    diagnostics: FeedbackDiagnosticsSchema.optional(),
    attachments: z.array(FeedbackAttachmentSchema).max(MAX_FEEDBACK_FILES).optional(),
  })
  .strict()
  .refine(
    (input) =>
      (input.attachments ?? []).reduce((sum, file) => sum + file.size, 0) <=
      MAX_FEEDBACK_TOTAL_BYTES,
    'Attachments must total 20 MB or less.',
  );

export type FeedbackInput = z.infer<typeof FeedbackInputSchema>;
export const GitHubIssueDraftSchema = z.object({
  githubIssueUrl: z.string().url(),
  body: z.string(),
  needsBodyPaste: z.boolean(),
});
export type GitHubIssueDraft = z.infer<typeof GitHubIssueDraftSchema>;
