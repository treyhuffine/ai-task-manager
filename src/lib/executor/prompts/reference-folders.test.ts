import { describe, it, expect } from 'vitest';
import {
  renderReferenceFoldersPrompt,
  renderGitLine,
} from '@/lib/executor/prompts/reference-folders';
import type { ResolvedReferenceFolder } from '@/db/types';

function ref(overrides: Partial<ResolvedReferenceFolder> = {}): ResolvedReferenceFolder {
  return {
    id: 'ref-1',
    createdAt: '2026-07-28T00:00:00.000Z',
    updatedAt: '2026-07-28T00:00:00.000Z',
    workspaceId: 'ws-1',
    alias: 'backend',
    path: '/code/api',
    targetWorkspaceId: null,
    description: null,
    position: 0,
    status: 'active',
    archivedAt: null,
    absolutePath: '/code/api',
    exists: true,
    git: null,
    global: false,
    ...overrides,
  };
}

describe('renderReferenceFoldersPrompt', () => {
  it('renders nothing when there are no references, so a bare workspace pays no context', () => {
    expect(renderReferenceFoldersPrompt([])).toBe('');
  });

  it('renders alias and absolute path for a minimal reference', () => {
    const out = renderReferenceFoldersPrompt([ref()]);
    expect(out).toContain('# Reference folders (read-only)');
    expect(out).toContain('- backend  ->  /code/api');
  });

  it('tells the agent not to modify them', () => {
    const out = renderReferenceFoldersPrompt([ref()]);
    expect(out).toMatch(/Do not modify/i);
    expect(out).toMatch(/say so instead of\s+making it/i);
  });

  it('includes the description when present and omits the line when absent', () => {
    const withDesc = renderReferenceFoldersPrompt([
      ref({ description: 'Go API server this app calls.' }),
    ]);
    expect(withDesc).toContain('  Go API server this app calls.');

    const withoutDesc = renderReferenceFoldersPrompt([ref()]);
    const entryLines = withoutDesc
      .split('\n')
      .slice(withoutDesc.split('\n').indexOf('- backend  ->  /code/api'));
    // Nothing indented follows the entry when there is no description or git.
    expect(entryLines.filter((l) => l.startsWith('  '))).toHaveLength(0);
  });

  it('includes a git line only for repos', () => {
    const repo = renderReferenceFoldersPrompt([
      ref({ git: { branch: 'main', dirty: false, ahead: 0, behind: 4 } }),
    ]);
    expect(repo).toContain('  git: main, clean, 4 behind origin');

    expect(renderReferenceFoldersPrompt([ref({ git: null })])).not.toContain('git:');
  });

  it('preserves the order it is given, so position ordering survives', () => {
    const out = renderReferenceFoldersPrompt([
      ref({ id: 'a', alias: 'first', absolutePath: '/one', position: 0 }),
      ref({ id: 'b', alias: 'second', absolutePath: '/two', position: 1 }),
      ref({ id: 'c', alias: 'third', absolutePath: '/three', position: 2 }),
    ]);
    expect(out.indexOf('first')).toBeLessThan(out.indexOf('second'));
    expect(out.indexOf('second')).toBeLessThan(out.indexOf('third'));
  });

  it('renders every reference it is handed', () => {
    const out = renderReferenceFoldersPrompt([
      ref({ id: 'a', alias: 'backend', absolutePath: '/code/api' }),
      ref({ id: 'b', alias: 'vault', absolutePath: '/notes' }),
    ]);
    expect(out).toContain('- backend  ->  /code/api');
    expect(out).toContain('- vault  ->  /notes');
  });
});

describe('renderGitLine', () => {
  it('returns null for a non-repo', () => {
    expect(renderGitLine(ref({ git: null }))).toBeNull();
  });

  it('reports a clean checkout with no drift', () => {
    expect(renderGitLine(ref({ git: { branch: 'main', dirty: false, ahead: 0, behind: 0 } }))).toBe(
      'git: main, clean',
    );
  });

  it('reports uncommitted work', () => {
    expect(renderGitLine(ref({ git: { branch: 'main', dirty: true, ahead: 0, behind: 0 } }))).toBe(
      'git: main, uncommitted changes',
    );
  });

  it('reports drift in both directions — the whole reason this line exists', () => {
    expect(
      renderGitLine(ref({ git: { branch: 'feat/x', dirty: false, ahead: 2, behind: 9 } })),
    ).toBe('git: feat/x, clean, 9 behind origin, 2 ahead of origin');
  });

  it('names a detached HEAD rather than pretending there is a branch', () => {
    expect(renderGitLine(ref({ git: { branch: null, dirty: false, ahead: null, behind: null } }))).toBe(
      'git: detached HEAD, clean',
    );
  });

  it('omits ahead/behind entirely when there is no upstream', () => {
    const line = renderGitLine(
      ref({ git: { branch: 'main', dirty: false, ahead: null, behind: null } }),
    );
    expect(line).toBe('git: main, clean');
  });
});
