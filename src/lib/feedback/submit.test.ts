import { describe, expect, it, vi, afterEach } from 'vitest';
import { prepareGitHubIssue } from './submit';
import { FeedbackInputSchema } from './schema';

const value = () => ({
  kind: 'bug' as const,
  message: 'The task did not open',
  includeDiagnostics: true,
  diagnostics: { view: 'home', viewport: 'phone' as const, theme: 'dark' as const },
});
afterEach(() => vi.restoreAllMocks());
describe('GitHub feedback drafts', () => {
  it('prepares one public issue destination without publishing or calling any external service', () => {
    const fetcher = vi.spyOn(globalThis, 'fetch');
    const draft = prepareGitHubIssue(value());
    const url = new URL(draft.githubIssueUrl);
    expect(url.origin + url.pathname).toBe('https://github.com/dynamismlabs/ri/issues/new');
    expect(url.searchParams.get('title')).toBe('[Bug] The task did not open');
    expect(url.searchParams.get('labels')).toBe('bug');
    expect(url.searchParams.get('body')).toBe(draft.body);
    expect(draft.body).toContain('### App & view info');
    expect(draft.needsBodyPaste).toBe(false);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('omits all app diagnostics when unchecked, even if supplied', () => {
    const draft = prepareGitHubIssue({ ...value(), includeDiagnostics: false });
    expect(draft.body).toBe('The task did not open');
    expect(new URL(draft.githubIssueUrl).searchParams.get('body')).toBe(draft.body);
  });
  it.each([
    ['feedback', 'enhancement', 'Feedback'],
    ['bug', 'bug', 'Bug'],
    ['question', 'question', 'Question'],
  ] as const)(
    'routes %s into the same repository with its matching label',
    (kind, label, prefix) => {
      const url = new URL(prepareGitHubIssue({ ...value(), kind }).githubIssueUrl);
      expect(url.searchParams.get('labels')).toBe(label);
      expect(url.searchParams.get('title')).toContain(`[${prefix}]`);
    },
  );
  it('makes the manual attachment step explicit without exposing Home file URLs', () => {
    const draft = prepareGitHubIssue({
      ...value(),
      attachments: [
        {
          fileName: '019e0000-0000-7000-8000-000000000001.png',
          originalName: 'screen.png',
          mimeType: 'image/png',
          size: 100,
          uploadedAt: 'now',
        },
      ],
    });
    expect(draft.body).toContain('Add the selected files');
    expect(draft.body).toContain('does not upload them to GitHub automatically');
    expect(draft.body).not.toContain('/api/attachments');
    expect(draft.body).not.toContain('019e0000');
  });
  it('keeps long reports intact for copying while bounding the prefilled URL', () => {
    const message = 'A detailed bug report. '.repeat(400);
    const draft = prepareGitHubIssue({ ...value(), message, includeDiagnostics: false });
    expect(draft.needsBodyPaste).toBe(true);
    expect(draft.body).toBe(message.trim());
    expect(draft.githubIssueUrl.length).toBeLessThan(7000);
    expect(new URL(draft.githubIssueUrl).searchParams.get('body')).toContain(
      'Paste the full report',
    );
  });
  it('rejects empty messages, too many files and invalid attachment metadata', () => {
    expect(FeedbackInputSchema.safeParse({ ...value(), message: ' ' }).success).toBe(false);
    expect(
      FeedbackInputSchema.safeParse({
        ...value(),
        attachments: [
          {
            fileName: '../private',
            originalName: 'x',
            size: 1,
            mimeType: 'text/plain',
            uploadedAt: 'now',
          },
        ],
      }).success,
    ).toBe(false);
  });
});
