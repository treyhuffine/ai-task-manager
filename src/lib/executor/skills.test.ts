import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

import { inventorySkills, resolveSkillDirsForSession, resolveSkillsForSession } from './skills';

const TMP_ROOT = path.join(os.tmpdir(), `ri-skills-test-${process.pid}`);
// Global skills resolve at <home>/skills, and the home is the app root now.
const BRAIN_DIR = TMP_ROOT;
const WORKSPACE_DIR = path.join(TMP_ROOT, 'ws');
let prevRoot: string | undefined;

beforeEach(() => {
  fs.rmSync(TMP_ROOT, { recursive: true, force: true });
  fs.mkdirSync(BRAIN_DIR, { recursive: true });
  fs.mkdirSync(WORKSPACE_DIR, { recursive: true });
  prevRoot = process.env.RI_ROOT;
  process.env.RI_ROOT = TMP_ROOT;
});

afterAll(() => {
  if (prevRoot === undefined) delete process.env.RI_ROOT;
  else process.env.RI_ROOT = prevRoot;
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

  it('finds workspace skills under <ws>/.ri/skills/', () => {
    writeSkill(path.join(WORKSPACE_DIR, '.ri', 'skills'), 'lint-fixer', '---\nname: lint-fixer\n---\n');
    const inventory = inventorySkills(WORKSPACE_DIR);
    expect(inventory.some((s) => s.name === 'lint-fixer' && s.scope === 'workspace')).toBe(true);
  });

  it('workspace overrides global on name collision', () => {
    writeSkill(path.join(BRAIN_DIR, 'skills'), 'shared', '---\nname: shared\n---\nglobal\n');
    writeSkill(path.join(WORKSPACE_DIR, '.ri', 'skills'), 'shared', '---\nname: shared\n---\nlocal\n');
    const inventory = inventorySkills(WORKSPACE_DIR);
    const hit = inventory.find((s) => s.name === 'shared');
    expect(hit).toBeDefined();
    expect(hit!.scope).toBe('workspace');
    expect(hit!.sourceDir).toContain('.ri/skills/shared');
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

describe('what a session gets', () => {
  it('leaves out the skills the home excluded for this chat', () => {
    writeSkill(path.join(BRAIN_DIR, 'skills'), 'kept', '---\nname: kept\n---\n');
    writeSkill(path.join(BRAIN_DIR, 'skills'), 'off', '---\nname: off\n---\n');
    const names = resolveSkillsForSession(null, { exclude: ['off'] }).map((s) => s.name);
    expect(names).toEqual(['kept']);
  });

  it('never excludes a folder skill, which belongs to the folder', () => {
    writeSkill(path.join(WORKSPACE_DIR, '.ri', 'skills'), 'local', '---\nname: local\n---\n');
    const names = resolveSkillsForSession(WORKSPACE_DIR, { exclude: ['local'] }).map((s) => s.name);
    expect(names).toEqual(['local']);
  });

  it('attaches the extra folders the home added, and skips one without a SKILL.md', () => {
    const elsewhere = path.join(TMP_ROOT, 'project', '.claude', 'skills');
    writeSkill(elsewhere, 'project-skill', '---\nname: project-skill\n---\n');
    fs.mkdirSync(path.join(elsewhere, 'empty'), { recursive: true });
    const skills = resolveSkillsForSession(null, { extra: [path.join(elsewhere, 'project-skill'), path.join(elsewhere, 'empty')] });
    expect(skills.map((s) => s.name)).toEqual(['project-skill']);
  });
});
