import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SkillError,
  archiveFolder,
  copySkillFolder,
  createSkillAt,
  moveSkillFolder,
  readSkillAt,
  readSupportingFile,
  writeSkillAt,
} from './library';

let root: string;
let skills: string;
let savedRoot: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-library-'));
  skills = path.join(root, 'skills');
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

const dir = (name: string) => path.join(skills, name);

describe('one skill folder', () => {
  it('creates and reads a skill named after its folder', () => {
    createSkillAt(dir('triage-inbox'), { description: 'Triage the inbox.', body: '# Triage\n' });
    expect(fs.readFileSync(path.join(dir('triage-inbox'), 'SKILL.md'), 'utf8')).toBe(
      '---\nname: triage-inbox\ndescription: Triage the inbox.\n---\n# Triage\n',
    );
    const skill = readSkillAt(dir('triage-inbox'))!;
    expect(skill.name).toBe('triage-inbox');
    expect(skill.parsed.body).toBe('# Triage\n');
    expect(skill.problems).toEqual([]);
    expect(skill.hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it('refuses a bad name or an existing folder', () => {
    expect(codeOf(() => createSkillAt(dir('Bad Name')))).toBe('invalid');
    createSkillAt(dir('taken'));
    expect(codeOf(() => createSkillAt(dir('taken')))).toBe('conflict');
  });

  it('reads a hand-made folder whose name breaks the rules, and says what to fix', () => {
    fs.mkdirSync(dir('MySkill'), { recursive: true });
    fs.writeFileSync(path.join(dir('MySkill'), 'SKILL.md'), '---\nname: MySkill\ndescription: d\n---\n');
    expect(readSkillAt(dir('MySkill'))!.problems.map((p) => p.field)).toContain('name');
  });

  it('answers null for a folder without SKILL.md', () => {
    fs.mkdirSync(dir('empty'), { recursive: true });
    expect(readSkillAt(dir('empty'))).toBeNull();
  });
});

describe('writeSkillAt', () => {
  beforeEach(() => {
    createSkillAt(dir('review'), { description: 'Review things.', body: 'Old body.\n' });
  });

  it('changes fields and keeps the rest of the file', () => {
    fs.writeFileSync(
      path.join(dir('review'), 'SKILL.md'),
      '---\nname: review\ndescription: Review things.\nlicense: MIT\n---\nOld body.\n',
    );
    const out = writeSkillAt(dir('review'), { fields: { body: 'New body.\n' } });
    expect(out.content).toBe('---\nname: review\ndescription: Review things.\nlicense: MIT\n---\nNew body.\n');
  });

  it('replaces the whole file with content', () => {
    expect(writeSkillAt(dir('review'), { content: '---\nname: review\ndescription: New.\n---\nX\n' }).parsed.description).toBe('New.');
  });

  it('refuses a write based on a stale copy, and returns the current one', () => {
    const before = readSkillAt(dir('review'))!;
    writeSkillAt(dir('review'), { fields: { body: 'Someone else.\n' } });
    try {
      writeSkillAt(dir('review'), { fields: { body: 'Mine.\n' }, baseHash: before.hash });
      expect.unreachable();
    } catch (err) {
      expect((err as SkillError).code).toBe('stale');
      expect((err as SkillError).current?.parsed.body).toBe('Someone else.\n');
    }
    expect(readSkillAt(dir('review'))!.parsed.body).toBe('Someone else.\n');
  });

  it('treats a retry of a write that already landed as done, not stale', () => {
    const before = readSkillAt(dir('review'))!;
    writeSkillAt(dir('review'), { fields: { body: 'Mine.\n' }, baseHash: before.hash });
    expect(writeSkillAt(dir('review'), { fields: { body: 'Mine.\n' }, baseHash: before.hash }).parsed.body).toBe('Mine.\n');
  });

  it('writes and deletes supporting files, pruning empty folders', () => {
    const written = writeSkillAt(dir('review'), {
      files: [
        { path: 'references/guide.md', content: '# Guide\n' },
        { path: 'scripts/run.sh', content: 'echo hi\n' },
      ],
    });
    expect(written.files).toEqual([
      { path: 'references/guide.md', size: 8 },
      { path: 'scripts/run.sh', size: 8 },
    ]);
    const removed = writeSkillAt(dir('review'), { files: [{ path: 'scripts/run.sh', content: null }] });
    expect(removed.files.map((f) => f.path)).toEqual(['references/guide.md']);
    expect(fs.existsSync(path.join(dir('review'), 'scripts'))).toBe(false);
  });

  it('writes a binary file sent as base64, byte for byte, and treats its retry as done', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0x10]);
    const before = readSkillAt(dir('review'))!;
    const write = { files: [{ path: 'assets/logo.png', content: png.toString('base64'), encoding: 'base64' as const }], baseHash: before.hash };
    expect(writeSkillAt(dir('review'), write).files).toEqual([{ path: 'assets/logo.png', size: png.length }]);
    expect(fs.readFileSync(path.join(dir('review'), 'assets/logo.png')).equals(png)).toBe(true);
    writeSkillAt(dir('review'), { fields: { body: 'Someone else.\n' } });
    expect(codeOf(() => writeSkillAt(dir('review'), write))).toBeNull();
  });

  it('measures the 1 MB limit in bytes, after decoding', () => {
    const big = Buffer.alloc(1024 * 1024 + 1, 1).toString('base64');
    expect(codeOf(() => writeSkillAt(dir('review'), { files: [{ path: 'assets/big.bin', content: big, encoding: 'base64' }] }))).toBe('invalid');
    expect(codeOf(() => writeSkillAt(dir('review'), { files: [{ path: 'assets/ok.bin', content: Buffer.alloc(1024 * 1024).toString('base64'), encoding: 'base64' }] }))).toBeNull();
  });

  it('reads a supporting file as text only when it is text and small enough', () => {
    writeSkillAt(dir('review'), {
      files: [
        { path: 'scripts/run.py', content: 'print("héllo")\n' },
        { path: 'assets/logo.png', content: Buffer.from([0x89, 0x50, 0x00, 0x01]).toString('base64'), encoding: 'base64' },
        { path: 'assets/latin1.txt', content: Buffer.from([0x63, 0x61, 0x66, 0xe9]).toString('base64'), encoding: 'base64' },
      ],
    });
    expect(readSupportingFile(dir('review'), 'scripts/run.py')).toEqual({ path: 'scripts/run.py', size: 16, text: 'print("héllo")\n' });
    expect(readSupportingFile(dir('review'), 'assets/logo.png')).toMatchObject({ size: 4, text: null });
    expect(readSupportingFile(dir('review'), 'assets/latin1.txt').text).toBeNull();
    fs.writeFileSync(path.join(dir('review'), 'references-large.md'), 'x'.repeat(1024 * 1024 + 1));
    expect(readSupportingFile(dir('review'), 'references-large.md')).toMatchObject({ size: 1024 * 1024 + 1, text: null });
  });

  it('refuses to read SKILL.md, a missing file, a folder, or a path outside the skill', () => {
    writeSkillAt(dir('review'), { files: [{ path: 'scripts/run.py', content: 'x' }] });
    expect(codeOf(() => readSupportingFile(dir('review'), 'SKILL.md'))).toBe('invalid');
    expect(codeOf(() => readSupportingFile(dir('review'), '../../etc/passwd'))).toBe('invalid');
    expect(codeOf(() => readSupportingFile(dir('review'), 'scripts/missing.py'))).toBe('not_found');
    expect(codeOf(() => readSupportingFile(dir('review'), 'scripts'))).toBe('not_found');
    fs.writeFileSync(path.join(root, 'outside.md'), 'secret');
    fs.symlinkSync(path.join(root, 'outside.md'), path.join(dir('review'), 'linked.md'));
    expect(codeOf(() => readSupportingFile(dir('review'), 'linked.md'))).toBe('invalid');
  });

  it('refuses supporting file paths that leave the folder or touch SKILL.md', () => {
    for (const bad of ['../x.md', '/etc/passwd', 'a/../../x', 'SKILL.md', '.git/config', 'C:/x', 'a//b']) {
      expect(codeOf(() => writeSkillAt(dir('review'), { files: [{ path: bad, content: 'x' }] }))).toBe('invalid');
    }
  });

  it('checks every file before writing any', () => {
    expect(
      codeOf(() =>
        writeSkillAt(dir('review'), {
          fields: { body: 'Should not land.\n' },
          files: [
            { path: 'ok.md', content: 'ok' },
            { path: '../bad.md', content: 'bad' },
          ],
        }),
      ),
    ).toBe('invalid');
    expect(readSkillAt(dir('review'))!.parsed.body).toBe('Old body.\n');
    expect(fs.existsSync(path.join(dir('review'), 'ok.md'))).toBe(false);
  });

  it('answers not_found for a missing skill', () => {
    expect(codeOf(() => writeSkillAt(dir('missing'), { fields: { body: 'x' } }))).toBe('not_found');
  });
});

describe('moving, copying and archiving a folder', () => {
  it('moves (a rename or elsewhere) and sets name: to match', () => {
    createSkillAt(dir('old-name'), { description: 'D.', body: 'B\n' });
    const elsewhere = path.join(root, 'other', 'new-name');
    const moved = moveSkillFolder(dir('old-name'), elsewhere);
    expect(moved.name).toBe('new-name');
    expect(moved.parsed.name).toBe('new-name');
    expect(moved.problems).toEqual([]);
    expect(fs.existsSync(dir('old-name'))).toBe(false);
  });

  it('copies and leaves the original', () => {
    createSkillAt(dir('keep'), { description: 'D.', body: 'B\n' });
    fs.writeFileSync(path.join(dir('keep'), 'notes.md'), 'n');
    const copy = copySkillFolder(dir('keep'), path.join(root, 'project', 'keep'));
    expect(copy.files.map((f) => f.path)).toEqual(['notes.md']);
    expect(readSkillAt(dir('keep'))).not.toBeNull();
  });

  it('refuses a bad or occupied target', () => {
    createSkillAt(dir('a'), { description: 'D.' });
    createSkillAt(dir('b'), { description: 'D.' });
    expect(codeOf(() => moveSkillFolder(dir('a'), dir('b')))).toBe('conflict');
    expect(codeOf(() => moveSkillFolder(dir('a'), dir('Not Valid')))).toBe('invalid');
    expect(codeOf(() => copySkillFolder(dir('a'), dir('b')))).toBe('conflict');
  });

  it('archives into <app-root>/.archive and never overwrites an earlier archive', () => {
    createSkillAt(dir('gone'), { description: 'D.' });
    const first = archiveFolder(dir('gone'), 'skills', 'ri-gone');
    createSkillAt(dir('gone'), { description: 'D2.' });
    const second = archiveFolder(dir('gone'), 'skills', 'ri-gone');
    expect(path.dirname(first)).toBe(path.join(root, '.archive', 'skills'));
    expect(first).not.toBe(second);
    expect(fs.existsSync(path.join(second, 'SKILL.md'))).toBe(true);
    expect(readSkillAt(dir('gone'))).toBeNull();
  });
});
