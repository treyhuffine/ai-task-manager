import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createGitFixture, git, type GitFixture } from '@/test/fixtures/git';
import {
  ensureGitIgnored,
  readSetupFile,
  renderSetupFile,
  SETUP_FILE,
  SetupFileConflictError,
  writeSetupFile,
  type SetupFile,
} from './local-file';

const file = (over: Partial<SetupFile> = {}): SetupFile => ({
  version: 1,
  homeId: 'home-1',
  agents: { 'agent-1': { references: { agentex: '../agentex', docs: { agentId: 'agent-2' }, vault: null } } },
  ...over,
});

let g: GitFixture;
let repo: string;

beforeEach(() => {
  g = createGitFixture();
  repo = g.clone(g.remote('app'), path.join(g.base, 'mini', 'app'));
});

afterEach(() => {
  g.cleanup();
});

describe('reading', () => {
  it('reports a missing file', () => {
    expect(readSetupFile(repo)).toEqual({ state: 'missing', dir: repo });
  });

  it('parses all three reference forms and fingerprints the exact bytes', () => {
    const rev = writeSetupFile(repo, file(), null);
    const read = readSetupFile(repo);
    expect(read.state).toBe('ok');
    if (read.state !== 'ok') return;
    expect(read.revision).toBe(rev);
    expect(read.file.agents['agent-1']!.references).toEqual({ agentex: '../agentex', docs: { agentId: 'agent-2' }, vault: null });
  });

  it('names what is wrong with a malformed or foreign file', () => {
    fs.writeFileSync(path.join(repo, SETUP_FILE), '{ nope');
    expect(readSetupFile(repo)).toMatchObject({ state: 'invalid', problem: expect.stringMatching(/not valid JSON/) });
    fs.writeFileSync(path.join(repo, SETUP_FILE), JSON.stringify({ version: 1, agents: {} }));
    expect(readSetupFile(repo)).toMatchObject({ state: 'invalid', problem: expect.stringMatching(/malformed at homeId/) });
    fs.writeFileSync(path.join(repo, SETUP_FILE), JSON.stringify({ ...file(), cwd: '/abs/path' }));
    expect(readSetupFile(repo)).toMatchObject({ state: 'invalid' });
  });
});

describe('writing', () => {
  it('creates only when there is no file, and never overwrites one', () => {
    writeSetupFile(repo, file(), null);
    expect(() => writeSetupFile(repo, file({ homeId: 'other' }), null)).toThrow(SetupFileConflictError);
    const read = readSetupFile(repo);
    expect(read.state === 'ok' && read.file.homeId).toBe('home-1');
  });

  it('replaces only the revision an edit was made against', () => {
    const rev1 = writeSetupFile(repo, file(), null);
    // Someone edits the file by hand.
    const edited = renderSetupFile(file({ agents: { 'agent-1': { references: { agentex: '/abs/agentex' } } } }));
    fs.writeFileSync(path.join(repo, SETUP_FILE), edited);
    // A UI edit made against the old revision must not win.
    expect(() => writeSetupFile(repo, file({ agents: {} }), rev1)).toThrow(SetupFileConflictError);
    const now = readSetupFile(repo);
    expect(now.state === 'ok' && now.file.agents['agent-1']!.references.agentex).toBe('/abs/agentex');
    // Made against the current revision, it applies.
    if (now.state !== 'ok') return;
    const rev3 = writeSetupFile(repo, file({ agents: {} }), now.revision);
    expect(rev3).not.toBe(now.revision);
  });

  it('writes a private file and leaves no temp files behind', () => {
    writeSetupFile(repo, file(), null);
    expect(fs.statSync(path.join(repo, SETUP_FILE)).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(repo).filter((f) => f.includes('.tmp'))).toEqual([]);
  });
});

describe('keeping it out of Git', () => {
  it('adds a local exclude when the repository does not ignore it, once', () => {
    writeSetupFile(repo, file(), null);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(ensureGitIgnored(repo)).toBe('already_ignored');
    const exclude = fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8');
    expect(exclude.match(/\/\.ri\.local\.json/g)).toHaveLength(1);
  });

  it('respects a repository that already ignores it', () => {
    g.commit(repo, { '.gitignore': '.ri.local.json\n' });
    expect(ensureGitIgnored(repo)).toBe('already_ignored');
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).not.toMatch(/ri\.local/);
  });

  it('excludes the file inside a monorepo subfolder by its path', () => {
    const sub = path.join(repo, 'apps', 'web');
    fs.mkdirSync(sub, { recursive: true });
    writeSetupFile(sub, file(), null);
    expect(git(repo, 'status', '--porcelain')).toBe('');
    expect(fs.readFileSync(path.join(repo, '.git', 'info', 'exclude'), 'utf8')).toMatch(/^\/apps\/web\/\.ri\.local\.json$/m);
  });

  it('leaves a folder outside Git alone', () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-plain-'));
    try {
      writeSetupFile(plain, file(), null);
      expect(ensureGitIgnored(plain)).toBe('not_git');
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });

  it('works in a linked worktree, whose .git is a file', () => {
    const wt = path.join(g.base, 'wt');
    git(repo, 'worktree', 'add', '-q', '-b', 'feature', wt);
    writeSetupFile(wt, file(), null);
    expect(git(wt, 'status', '--porcelain')).toBe('');
  });
});
