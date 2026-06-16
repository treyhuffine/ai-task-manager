import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { APP_ROOT_ENV } from './paths';
import { migrateLayout } from './paths';

let root: string;
let prevRoot: string | undefined;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'flow-migrate-test-'));
  prevRoot = process.env[APP_ROOT_ENV];
  process.env[APP_ROOT_ENV] = root;
});

afterEach(() => {
  if (prevRoot === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = prevRoot;
  fs.rmSync(root, { recursive: true, force: true });
});

const write = (rel: string, body = 'x') => {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, body);
};
const exists = (rel: string) => fs.existsSync(path.join(root, rel));
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

describe('migrateLayout', () => {
  it('migrates a brain-era install: content → root, scratch → .work, config → .config', () => {
    // Brain-era layout.
    write('brain/data.db', 'DB');
    write('brain/tasks/a--1.md');
    write('brain/attachments/x.png');
    write('brain/MEMORY.md', 'mem');
    write('brain/USER.md', 'me');
    write('brain/skills/my-skill/SKILL.md', 'skill'); // user-authored global skill
    write('brain/icons/cache.png'); // machine-local, was wrongly in brain
    write('brain/preview/k.pid'); // runtime, was in brain
    write('config.json', 'TOKEN');
    write('preview.json', 'provider');
    write('cli-config.json', 'editor'); // machine-local CLI pref
    write('worktrees/repo/file');
    write('clones/repo/file');
    write('tmp/scratch');

    const result = migrateLayout();
    expect(result.migrated).toBe(true);

    // Content pulled to the home root.
    expect(read('data.db')).toBe('DB');
    expect(exists('tasks/a--1.md')).toBe(true);
    expect(exists('attachments/x.png')).toBe(true);
    expect(read('MEMORY.md')).toBe('mem');
    expect(read('USER.md')).toBe('me');
    expect(exists('skills/my-skill/SKILL.md')).toBe(true); // global skills follow content to root
    // Precious-local → .config.
    expect(read('.config/config.json')).toBe('TOKEN');
    expect(read('.config/preview.json')).toBe('provider');
    expect(read('.config/cli-config.json')).toBe('editor');
    // Disposable scratch → .work (incl. the bits that were stuck in brain).
    expect(exists('.work/tmp/scratch')).toBe(true);
    expect(exists('.work/icons/cache.png')).toBe(true);
    expect(exists('.work/preview/k.pid')).toBe(true);
    // worktrees/clones are DB-referenced + may hold uncommitted work → NOT
    // moved; left in place (gitignored separately).
    expect(exists('worktrees/repo/file')).toBe(true);
    expect(exists('clones/repo/file')).toBe(true);
    expect(exists('.work/worktrees')).toBe(false);
    // Old content/config locations gone.
    expect(exists('brain')).toBe(false);
    expect(exists('config.json')).toBe(false);
  });

  it('migrates a flat-era install (content already at root): only relocates config + scratch', () => {
    write('data.db', 'DB');
    write('tasks/a--1.md');
    write('config.json', 'TOKEN');
    write('worktrees/repo/file');

    const result = migrateLayout();
    expect(result.migrated).toBe(true);

    expect(read('data.db')).toBe('DB'); // untouched at root
    expect(exists('tasks/a--1.md')).toBe(true);
    expect(read('.config/config.json')).toBe('TOKEN');
    expect(exists('worktrees/repo/file')).toBe(true); // left in place, not moved
    expect(exists('config.json')).toBe(false);
  });

  it('is idempotent — a second run moves nothing and never clobbers', () => {
    write('brain/data.db', 'DB');
    write('config.json', 'TOKEN');
    migrateLayout();
    const first = read('.config/config.json');

    const second = migrateLayout();
    expect(second.migrated).toBe(false);
    expect(second.moved).toEqual([]);
    expect(read('.config/config.json')).toBe(first); // unchanged
    expect(read('data.db')).toBe('DB');
  });

  it('no-ops on a fresh/empty home', () => {
    fs.mkdirSync(root, { recursive: true });
    const result = migrateLayout();
    expect(result.migrated).toBe(false);
  });

  it('never clobbers an already-migrated target (mixed state)', () => {
    // Both an old root config.json AND a new .config/config.json exist.
    write('config.json', 'OLD');
    write('.config/config.json', 'NEW');
    migrateLayout();
    // The already-migrated value wins; the stale source is left, not merged.
    expect(read('.config/config.json')).toBe('NEW');
  });

  it('is skipped entirely when FLOW_DB_PATH is set (advanced custom DB)', () => {
    write('brain/data.db', 'DB');
    write('config.json', 'TOKEN');
    const prev = process.env.FLOW_DB_PATH;
    process.env.FLOW_DB_PATH = path.join(root, 'custom.db');
    try {
      const result = migrateLayout();
      expect(result.migrated).toBe(false);
      expect(exists('brain/data.db')).toBe(true); // untouched
      expect(exists('.config')).toBe(false);
    } finally {
      if (prev === undefined) delete process.env.FLOW_DB_PATH;
      else process.env.FLOW_DB_PATH = prev;
    }
  });
});
