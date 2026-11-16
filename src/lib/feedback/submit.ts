import { runtimeReleaseIdentity } from '@/lib/releases/runtime-identity';
import {
  FeedbackInputSchema,
  GITHUB_ISSUES_NEW_URL,
  type FeedbackInput,
  type GitHubIssueDraft,
} from './schema';

/** Prepares a public issue composer. Opening it never publishes an issue. */
export function prepareGitHubIssue(input: FeedbackInput): GitHubIssueDraft {
  input = FeedbackInputSchema.parse(input);
  const sections = [input.message];
  if (input.includeDiagnostics) {
    let version = 'unknown';
    let build = 'unknown';
    try {
      const release = runtimeReleaseIdentity();
      version = release.version;
      build = release.build;
    } catch {
      /* The report still works without release metadata. */
    }
    const info = {
      Version: `${version} (${build})`,
      Platform: `${process.platform} (${process.arch})`,
      View: input.diagnostics?.view,
      Screen: input.diagnostics?.viewport,
      Theme: input.diagnostics?.theme,
      Surface: input.diagnostics?.surface,
      Home: input.diagnostics?.homeKind,
      Browser: input.diagnostics?.userAgent,
    };
    sections.push(
      `### App & view info\n${Object.entries(info)
        .filter(([, value]) => value != null)
        .map(([key, value]) => `- ${key}: ${value}`)
        .join('\n')}`,
    );
  }
  if (input.attachments?.length)
    sections.push(
      '### Screenshots and files\nAdd the selected files to this issue before publishing. Ri does not upload them to GitHub automatically.',
    );
  const body = sections.join('\n\n');
  const prefix = { feedback: 'Feedback', bug: 'Bug', question: 'Question' }[input.kind];
  const firstLine = input.message.split(/\r?\n/)[0]?.trim() ?? '';
  const params = new URLSearchParams({
    title: `[${prefix}] ${firstLine.length > 72 ? firstLine.slice(0, 69) + '...' : firstLine}`,
    labels: { feedback: 'enhancement', bug: 'bug', question: 'question' }[input.kind],
    body,
  });
  let githubIssueUrl = `${GITHUB_ISSUES_NEW_URL}?${params}`;
  // Large reports stay intact in the draft and can be copied instead of putting them in a long URL.
  const needsBodyPaste = githubIssueUrl.length > 7000;
  if (needsBodyPaste) {
    params.set('body', 'Paste the full report copied from Ri here before creating this issue.');
    githubIssueUrl = `${GITHUB_ISSUES_NEW_URL}?${params}`;
  }
  return { githubIssueUrl, body, needsBodyPaste };
}
