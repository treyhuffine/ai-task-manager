import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SkillError,
  archiveSkillFolder,
  createSkill,
  librarySkillsDir,
  listLibrarySkills,
  readSkill,
  renameSkillFolder,
  writeSkill,
} from './library';

let root: string;
let savedRoot: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-library-'));
  savedRoot = process.env.RI_ROOT;
  process.env.RI_ROOT = root;
});

afterEach(() => {
  if (savedRoot === undefined) delete process.env.RI_ROOT;
  else process.env.RI_ROOT = savedRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

function codeOf(fn: () => unknown): string | null {
  try {
    fn();
    return null;
  } catch (err) {
    return err instanceof SkillError ? err.code : 'other';
  }
}

describe('the skill library', () => {
  it('lives at <app-root>/skills', () => {
    expect(librarySkillsDir()).toBe(path.join(root, 'skills'));
  });

  it('creates, lists and reads a skill', () => {
    createSkill({ name: 'triage-inbox', description: 'Triage the inbox.', body: '# Triage\n' });
    expect(fs.readFileSync(path.join(root, 'skills', 'triage-inbox', 'SKILL.md'), 'utf8')).toBe(
      '---\nname: triage-inbox\ndescription: Triage the inbox.\n---\n# Triage\n',
    );
    expect(listLibrarySkills().map((s) => s.name)).toEqual(['triage-inbox']);
    const skill = readSkill('triage-inbox')!;
    expect(skill.parsed.body).toBe('# Triage\n');
    expect(skill.problems).toEqual([]);
    expect(skill.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses a bad or taken name', () => {
    expect(codeOf(() => createSkill({ name: 'Bad Name' }))).toBe('invalid');
    createSkill({ name: 'taken' });
    expect(codeOf(() => createSkill({ name: 'taken' }))).toBe('conflict');
  });

  it('lists only folders with a SKILL.md, and skips hidden ones', () => {
    fs.mkdirSync(path.join(root, 'skills', 'not-a-skill'), { recursive: true });
    fs.mkdirSync(path.join(root, 'skills', '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', '.hidden', 'SKILL.md'), '---\nname: x\n---\n');
    fs.writeFileSync(path.join(root, 'skills', 'stray.md'), 'x');
    createSkill({ name: 'real', description: 'Real.' });
    expect(listLibrarySkills().map((s) => s.name)).toEqual(['real']);
  });

  it('reads a hand-made folder whose name breaks the rules, and says what to fix', () => {
    fs.mkdirSync(path.join(root, 'skills', 'MySkill'), { recursive: true });
    fs.writeFileSync(path.join(root, 'skills', 'MySkill', 'SKILL.md'), '---\nname: MySkill\ndescription: d\n---\n');
    const skill = readSkill('MySkill')!;
    expect(skill.problems.map((p) => p.field)).toContain('name');
  });

  it('never resolves a name outside the library', () => {
    for (const name of ['../escape', 'a/b', '.', '..', '.hidden']) {
      expect(readSkill(name)).toBeNull();
    }
    expect(codeOf(() => writeSkill('../escape', { fields: { body: 'x' } }))).toBe('invalid');
  });
});

describe('writeSkill', () => {
  beforeEach(() => {
    createSkill({ name: 'review', description: 'Review things.', body: 'Old body.\n' });
  });

  it('changes fields and keeps the rest of the file', () => {
    fs.writeFileSync(
      path.join(root, 'skills', 'review', 'SKILL.md'),
      '---\nname: review\ndescription: Review things.\nlicense: MIT\n---\nOld body.\n',
    );
    const out = writeSkill('review', { fields: { body: 'New body.\n' } });
    expect(out.content).toBe('---\nname: review\ndescription: Review things.\nlicense: MIT\n---\nNew body.\n');
  });

  it('replaces the whole file with content', () => {
    const out = writeSkill('review', { content: '---\nname: review\ndescription: New.\n---\nX\n' });
    expect(out.parsed.description).toBe('New.');
  });

  it('refuses a write based on a stale copy, and returns the current one', () => {
    const before = readSkill('review')!;
    writeSkill('review', { fields: { body: 'Someone else.\n' } });
    try {
      writeSkill('review', { fields: { body: 'Mine.\n' }, baseHash: before.hash });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(SkillError);
      expect((err as SkillError).code).toBe('stale');
      expect((err as SkillError).current?.parsed.body).toBe('Someone else.\n');
    }
    expect(readSkill('review')!.parsed.body).toBe('Someone else.\n');
  });

  it('treats a retry of a write that already landed as done, not stale', () => {
    const before = readSkill('review')!;
    writeSkill('review', { fields: { body: 'Mine.\n' }, baseHash: before.hash });
    const retry = writeSkill('review', { fields: { body: 'Mine.\n' }, baseHash: before.hash });
    expect(retry.parsed.body).toBe('Mine.\n');
  });

  it('writes and deletes supporting files, pruning empty folders', () => {
    const written = writeSkill('review', {
      files: [
        { path: 'references/guide.md', content: '# Guide\n' },
        { path: 'scripts/run.sh', content: 'echo hi\n' },
      ],
    });
    expect(written.files).toEqual([
      { path: 'references/guide.md', size: 8 },
      { path: 'scripts/run.sh', size: 8 },
    ]);
    const removed = writeSkill('review', { files: [{ path: 'scripts/run.sh', content: null }] });
    expect(removed.files.map((f) => f.path)).toEqual(['references/guide.md']);
    expect(fs.existsSync(path.join(root, 'skills', 'review', 'scripts'))).toBe(false);
  });

  it('refuses supporting file paths that leave the folder or touch SKILL.md', () => {
    for (const bad of ['../x.md', '/etc/passwd', 'a/../../x', 'SKILL.md', '.git/config', 'C:/x', 'a//b']) {
      expect(codeOf(() => writeSkill('review', { files: [{ path: bad, content: 'x' }] }))).toBe('invalid');
    }
  });

  it('checks every file before writing any', () => {
    expect(
      codeOf(() =>
        writeSkill('review', {
          fields: { body: 'Should not land.\n' },
          files: [
            { path: 'ok.md', content: 'ok' },
            { path: '../bad.md', content: 'bad' },
          ],
        }),
      ),
    ).toBe('invalid');
    expect(readSkill('review')!.parsed.body).toBe('Old body.\n');
    expect(fs.existsSync(path.join(root, 'skills', 'review', 'ok.md'))).toBe(false);
  });

  it('answers not_found for a missing skill', () => {
    expect(codeOf(() => writeSkill('missing', { fields: { body: 'x' } }))).toBe('not_found');
  });
});

describe('renameSkillFolder and archiveSkillFolder', () => {
  it('moves the folder and sets name: to match', () => {
    createSkill({ name: 'old-name', description: 'D.', body: 'B\n' });
    const renamed = renameSkillFolder('old-name', 'new-name');
    expect(renamed.name).toBe('new-name');
    expect(renamed.parsed.name).toBe('new-name');
    expect(renamed.problems).toEqual([]);
    expect(fs.existsSync(path.join(root, 'skills', 'old-name'))).toBe(false);
  });

  it('refuses a bad or taken target', () => {
    createSkill({ name: 'a', description: 'D.' });
    createSkill({ name: 'b', description: 'D.' });
    expect(codeOf(() => renameSkillFolder('a', 'b'))).toBe('conflict');
    expect(codeOf(() => renameSkillFolder('a', 'Not Valid'))).toBe('invalid');
  });

  it('archives into <app-root>/.archive/skills and never overwrites an earlier archive', () => {
    createSkill({ name: 'gone', description: 'D.' });
    const first = archiveSkillFolder('gone');
    createSkill({ name: 'gone', description: 'D2.' });
    const second = archiveSkillFolder('gone');
    expect(path.dirname(first)).toBe(path.join(root, '.archive', 'skills'));
    expect(first).not.toBe(second);
    expect(fs.existsSync(path.join(first, 'SKILL.md'))).toBe(true);
    expect(fs.existsSync(path.join(second, 'SKILL.md'))).toBe(true);
    expect(readSkill('gone')).toBeNull();
  });
});
