import { describe, expect, it } from 'vitest';
import { GhCommandError, RepoNotFoundError } from '@agentex/github';
import { notOnGithub } from './execution-github';

describe('notOnGithub', () => {
  it('knows a repository with no remote, or none on GitHub, has no pull requests', () => {
    const none = new GhCommandError(['pr', 'list'], 1, '', 'none of the git remotes configured for this repository point to a known GitHub host. To tell gh about a new GitHub host, please use `gh auth login`');
    const missing = new GhCommandError(['pr', 'list'], 1, '', 'no git remotes found');
    expect(notOnGithub(none)).toBe(true);
    expect(notOnGithub(missing)).toBe(true);
  });

  it('leaves every other failure alone', () => {
    expect(notOnGithub(new GhCommandError(['pr', 'merge'], 1, '', 'Pull request is not mergeable'))).toBe(false);
    expect(notOnGithub(new RepoNotFoundError('could not resolve host'))).toBe(false);
    expect(notOnGithub(new Error('none of the git remotes'))).toBe(false);
    expect(notOnGithub('none of the git remotes')).toBe(false);
  });
});
