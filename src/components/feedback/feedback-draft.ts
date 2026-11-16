'use client';

import { useSyncExternalStore } from 'react';
import { z } from 'zod/v4';
import {
  FeedbackInputSchema,
  GitHubIssueDraftSchema,
  MAX_FEEDBACK_MESSAGE,
  type GitHubIssueDraft,
} from '@/lib/feedback/schema';

const draftSchema = z.object({
  ...FeedbackInputSchema.shape,
  message: z.string().max(MAX_FEEDBACK_MESSAGE),
  attachments: FeedbackInputSchema.shape.attachments.default([]),
});
type DraftValue = z.infer<typeof draftSchema>;
export interface FeedbackDraft {
  value: DraftValue;
  githubIssue?: GitHubIssueDraft;
  error: string | null;
  storageError: boolean;
  uploading: boolean;
  opening: boolean;
}
const drafts = new Map<string, FeedbackDraft>();
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
function empty(): FeedbackDraft {
  return {
    value: { kind: 'feedback', message: '', includeDiagnostics: true, attachments: [] },
    error: null,
    storageError: false,
    uploading: false,
    opening: false,
  };
}
export function getFeedbackDraft(key: string): FeedbackDraft {
  const cached = drafts.get(key);
  if (cached) return cached;
  const draft = empty();
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      draft.value = draftSchema.parse(parsed.value);
      if (parsed.githubIssue) draft.githubIssue = GitHubIssueDraftSchema.parse(parsed.githubIssue);
    }
  } catch {
    draft.storageError = true;
  }
  drafts.set(key, draft);
  return draft;
}
export function patchFeedbackDraft(key: string, patch: Partial<FeedbackDraft>): void {
  const draft = { ...getFeedbackDraft(key), ...patch };
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ value: draft.value, githubIssue: draft.githubIssue }),
    );
    draft.storageError = false;
  } catch {
    draft.storageError = true;
  }
  drafts.set(key, draft);
  emit();
}
export function editFeedbackDraft(key: string, patch: Partial<DraftValue>): void {
  const previous = getFeedbackDraft(key);
  if (previous.opening) return;
  patchFeedbackDraft(key, {
    value: { ...previous.value, ...patch },
    githubIssue: undefined,
    error: null,
  });
}
export function resetFeedbackDraft(key: string): void {
  drafts.set(key, empty());
  try {
    localStorage.removeItem(key);
  } catch {
    /* The next edit shows a storage error if saving fails. */
  }
  emit();
}
export function useFeedbackDraft(key: string): FeedbackDraft | null {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => {
        listeners.delete(callback);
      };
    },
    () => getFeedbackDraft(key),
    () => null,
  );
}
