import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { homeDocumentKey } from '@/lib/home/document-scope';
let storage: Map<string, string>;
beforeEach(() => {
  storage = new Map();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('restores text and the GitHub handoff after reload without claiming publication', async () => {
  const first = await import('./feedback-draft');
  const key = 'feedback-reload';
  first.editFeedbackDraft(key, { message: 'Keep this report' });
  const issue = {
    githubIssueUrl: 'https://github.com/dynamismlabs/ri/issues/new?body=test',
    body: 'Keep this report',
    needsBodyPaste: false,
  };
  first.patchFeedbackDraft(key, { githubIssue: issue, opening: true });
  vi.resetModules();
  const second = await import('./feedback-draft');
  expect(second.getFeedbackDraft(key).value.message).toBe('Keep this report');
  expect(second.getFeedbackDraft(key).githubIssue).toEqual(issue);
  expect(second.getFeedbackDraft(key).opening).toBe(false);
  expect(second.getFeedbackDraft(key)).not.toHaveProperty('result');
});
it('keeps different Home and member drafts apart', async () => {
  const drafts = await import('./feedback-draft');
  const key = (homeId: string, viewerId: string) =>
    'ri:' + homeDocumentKey('feedback', 'draft', { homeId, viewerId });
  drafts.editFeedbackDraft(key('home-one', 'member-one'), { message: 'My report' });
  expect(drafts.getFeedbackDraft(key('home-one', 'member-two')).value.message).toBe('');
  expect(drafts.getFeedbackDraft(key('home-two', 'member-one')).value.message).toBe('');
  expect(drafts.getFeedbackDraft(key('home-one', 'member-one')).value.message).toBe('My report');
});
it('prevents edits during preparation and discards the stale URL when editing afterward', async () => {
  const drafts = await import('./feedback-draft');
  const key = 'feedback-attempt';
  drafts.editFeedbackDraft(key, { message: 'Original' });
  drafts.patchFeedbackDraft(key, {
    opening: true,
    githubIssue: {
      githubIssueUrl: 'https://github.com/dynamismlabs/ri/issues/new',
      body: 'Original',
      needsBodyPaste: false,
    },
  });
  drafts.editFeedbackDraft(key, { message: 'Too late' });
  expect(drafts.getFeedbackDraft(key).value.message).toBe('Original');
  drafts.patchFeedbackDraft(key, { opening: false });
  drafts.editFeedbackDraft(key, { message: 'Revised' });
  expect(drafts.getFeedbackDraft(key).githubIssue).toBeUndefined();
});
it('shows a persistence failure instead of claiming an unsaved draft is safe', async () => {
  const drafts = await import('./feedback-draft');
  vi.stubGlobal('localStorage', {
    getItem: () => null,
    setItem: () => {
      throw new Error('quota');
    },
  });
  drafts.editFeedbackDraft('feedback-quota', { message: 'Keep open' });
  expect(drafts.getFeedbackDraft('feedback-quota').storageError).toBe(true);
});
