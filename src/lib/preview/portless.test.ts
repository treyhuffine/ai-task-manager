import { describe, it, expect } from 'vitest';
import { derivePortlessHostname } from './portless';

describe('derivePortlessHostname', () => {
  it('returns the slug for main worktree (no branch)', () => {
    expect(derivePortlessHostname({ slug: 'myapp' })).toBe('myapp');
  });

  it('prepends a branch as a subdomain segment for linked worktrees', () => {
    expect(derivePortlessHostname({ slug: 'myapp', worktreeBranch: 'fix-ui' })).toBe('fix-ui.myapp');
  });

  it('sanitizes slashes in branch names (matches Portless convention)', () => {
    expect(derivePortlessHostname({ slug: 'myapp', worktreeBranch: 'feature/auth' })).toBe('feature-auth.myapp');
  });

  it('sanitizes other non-DNS-safe characters', () => {
    expect(derivePortlessHostname({ slug: 'myapp', worktreeBranch: 'WIP: refactor' })).toBe('wip-refactor.myapp');
  });

  it('falls back to "app" when slug is empty', () => {
    expect(derivePortlessHostname({ slug: '' })).toBe('app');
  });

  it('treats null/undefined branch the same as no branch', () => {
    expect(derivePortlessHostname({ slug: 'myapp', worktreeBranch: null })).toBe('myapp');
    expect(derivePortlessHostname({ slug: 'myapp', worktreeBranch: undefined })).toBe('myapp');
  });

  it('falls back to base slug when branch sanitizes to empty', () => {
    // A pathological branch name that slugify reduces to empty.
    expect(derivePortlessHostname({ slug: 'myapp', worktreeBranch: '///' })).toBe('myapp');
  });

  it('lowercases mixed-case branches (DNS labels are case-insensitive)', () => {
    expect(derivePortlessHostname({ slug: 'myapp', worktreeBranch: 'FixUi' })).toBe('fix-ui.myapp');
  });
});
