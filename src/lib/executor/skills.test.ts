import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { inventorySkills, resolveSkillDirsForSession } from './skills';

const TMP_ROOT = path.join(os.tmpdir(), `flow-skills-test-${process.pid}`);
const BRAIN_DIR = path.join(TMP_ROOT, 'brain');
const WORKSPACE_DIR = path.join(TMP_ROOT, 'ws');

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(BRAIN_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  process.env.FLOW_BRAIN_PATH = BRAIN_DIR;
});

afterAll(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
});

function writeSkill(root: string, name: string, body: string) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), body);
}

describe('skill discovery', () => {
  it('finds global skills under <brain>/skills/', () => {
    writeSkill(path.join(BRAIN_DIR, 'skills'), 'github-pr-review', '---\nname: github-pr-review\n---\n');
    const dirs = resolveSkillDirsForSession(null);
    expect(dirs.some((d) => d.endsWith('github-pr-review'))).toBe(true);
  });

  it('finds workspace skills under <ws>/.flow/skills/', () => {
    writeSkill(path.join(WORKSPACE_DIR, '.flow', 'skills'), 'lint-fixer', '---\nname: lint-fixer\n---\n');
    const inventory = inventorySkills(WORKSPACE_DIR);
    expect(inventory.some((s) => s.name === 'lint-fixer' && s.scope === 'workspace')).toBe(true);
  });

  it('workspace overrides global on name collision', () => {
    writeSkill(path.join(BRAIN_DIR, 'skills'), 'shared', '---\nname: shared\n---\nglobal\n');
    writeSkill(path.join(WORKSPACE_DIR, '.flow', 'skills'), 'shared', '---\nname: shared\n---\nlocal\n');
    const inventory = inventorySkills(WORKSPACE_DIR);
    const hit = inventory.find((s) => s.name === 'shared');
    expect(hit).toBeDefined();
    expect(hit!.scope).toBe('workspace');
    expect(hit!.sourceDir).toContain('.flow/skills/shared');
  });

  it('handles missing skill dirs without error', () => {
    expect(resolveSkillDirsForSession(WORKSPACE_DIR)).toEqual([]);
    expect(inventorySkills(null)).toEqual([]);
  });

  it('skips directories without a SKILL.md file', () => {
    fs.mkdirSync(path.join(BRAIN_DIR, 'skills', 'incomplete'), { recursive: true });
    const inventory = inventorySkills(null);
    expect(inventory).toEqual([]);
  });
});
