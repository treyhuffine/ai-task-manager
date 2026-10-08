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
    readOnly: null,
    ...overrides,
  };
}

describe('renderReferenceFoldersPrompt', () => {
  it('renders nothing when there are no references, so a bare workspace pays no context', () => {
    expect(renderReferenceFoldersPrompt([])).toBe('');
  });

  it('renders alias and absolute path for a minimal reference', () => {
    const out = renderReferenceFoldersPrompt([ref()]);
    expect(out).toContain('# Linked folders');
    expect(out).toContain('- backend  ->  /code/api');
  });

  it('lets the agent change a folder nobody marked read only, the default', () => {
    for (const readOnly of [null, false]) {
      const out = renderReferenceFoldersPrompt([ref({ readOnly })]);
      expect(out).toMatch(/You may change these/);
      // A shared checkout: where edits land, and no branch switching under other work.
      expect(out).toMatch(/whatever is checked out there/);
      expect(out).toMatch(/Don't switch a Git folder's branch/);
      expect(out).not.toMatch(/Do not modify/i);
      expect(out).not.toMatch(/read only|read-only/i);
    }
  });

  it('tells the agent not to modify a read-only folder', () => {
    const out = renderReferenceFoldersPrompt([ref({ readOnly: true })]);
    expect(out.startsWith('# Linked folders (read only)')).toBe(true);
    expect(out).toMatch(/Do not modify anything in these/);
    expect(out).toMatch(/say so instead\s+of\s+making it/i);
    expect(out).not.toMatch(/You may change/);
  });

  it('splits a mixed list into an editable section and a read-only one', () => {
    const out = renderReferenceFoldersPrompt([
      ref({ id: 'a', alias: 'vault', absolutePath: '/notes', readOnly: true }),
      ref({ id: 'b', alias: 'backend', absolutePath: '/code/api' }),
      ref({ id: 'c', alias: 'docs', absolutePath: '/docs', readOnly: false }),
    ]);
    const editable = out.indexOf('## Editable');
    const readOnly = out.indexOf('## Read only');
    expect(editable).toBeGreaterThan(-1);
    expect(readOnly).toBeGreaterThan(editable);
    expect(out.indexOf('- backend')).toBeGreaterThan(editable);
    expect(out.indexOf('- docs')).toBeLessThan(readOnly);
    expect(out.indexOf('- backend')).toBeLessThan(out.indexOf('- docs'));
    expect(out.indexOf('- vault')).toBeGreaterThan(readOnly);
    expect(out.indexOf('Do not modify')).toBeGreaterThan(readOnly);
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
