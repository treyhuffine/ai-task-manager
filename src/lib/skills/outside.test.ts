import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { AGENT_BROWSER_SKILL_NAME } from '@/constants/app';
import { SkillError, createSkill, skillDir } from './library';
import {
  importOutsideSkill,
  installOutside,
  listOutsideSkills,
  outsideLinkState,
  removeOutside,
  removeSessionLinks,
} from './outside';

// agentex resolves ~/.claude/skills and ~/.agents/skills from $HOME at call
// time, so every test here runs against a throwaway home, never the real one.
let home: TestHome;
let userHome: string;
let savedHome: string | undefined;

beforeEach(async () => {
  home = await createTestHome({ prefix: 'ri-skill-outside-' });
  userHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-user-home-'));
  savedHome = process.env.HOME;
  process.env.HOME = userHome;
});

afterEach(async () => {
  process.env.HOME = savedHome;
  fs.rmSync(userHome, { recursive: true, force: true });
  await home.cleanup();
});

const claudeDir = () => path.join(userHome, '.claude', 'skills');
const agentsDir = () => path.join(userHome, '.agents', 'skills');

function plainSkill(dir: string, name: string, description = `${name} does things.`) {
  fs.mkdirSync(path.join(dir, name), { recursive: true });
  fs.writeFileSync(path.join(dir, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${description}\n---\nBody\n`);
}

describe('installOutside and removeOutside', () => {
  it('links the library folder into both user-level folders, and takes the links down', async () => {
    createSkill({ name: 'triage', description: 'Triage.' });
    await installOutside('triage');
    expect(fs.readlinkSync(path.join(claudeDir(), 'triage'))).toBe(skillDir('triage'));
    expect(fs.readlinkSync(path.join(agentsDir(), 'triage'))).toBe(skillDir('triage'));
    expect(await outsideLinkState('triage')).toEqual({ installed: true, channels: ['claude', 'agents'], conflicts: [] });

    await removeOutside('triage');
    expect(fs.existsSync(path.join(claudeDir(), 'triage'))).toBe(false);
    expect(await outsideLinkState('triage')).toEqual({ installed: false, channels: [], conflicts: [] });
  });

  it("refuses to replace someone else's skill with the same name", async () => {
    createSkill({ name: 'review', description: 'Mine.' });
    plainSkill(claudeDir(), 'review', 'Theirs.');
    await expect(installOutside('review')).rejects.toMatchObject({ code: 'conflict' });
    expect(fs.lstatSync(path.join(claudeDir(), 'review')).isSymbolicLink()).toBe(false);
    expect(fs.existsSync(path.join(agentsDir(), 'review'))).toBe(false);
  });

  it('only removes links that point at the library folder', async () => {
    createSkill({ name: 'review', description: 'Mine.' });
    plainSkill(claudeDir(), 'review', 'Theirs.');
    await removeOutside('review');
    expect(fs.existsSync(path.join(claudeDir(), 'review', 'SKILL.md'))).toBe(true);
  });

  it('stays inside the desktop app', async () => {
    createSkill({ name: 'triage', description: 'Triage.' });
    process.env.RI_DESKTOP = '1';
    try {
      await expect(installOutside('triage')).rejects.toBeInstanceOf(SkillError);
      expect(fs.existsSync(path.join(claudeDir(), 'triage'))).toBe(false);
    } finally {
      delete process.env.RI_DESKTOP;
    }
  });
});

describe('listOutsideSkills', () => {
  it("shows real skills Ri doesn't own, and nothing else", async () => {
    plainSkill(claudeDir(), 'implementing-specs');
    plainSkill(agentsDir(), 'implementing-specs');
    // Claude Desktop's container, not a skill.
    fs.mkdirSync(path.join(claudeDir(), 'synced', 'abc'), { recursive: true });
    // Ri's own shipped skill.
    const shipped = path.join(home.root, '.work', 'skills', AGENT_BROWSER_SKILL_NAME);
    plainSkill(path.dirname(shipped), AGENT_BROWSER_SKILL_NAME);
    fs.symlinkSync(shipped, path.join(claudeDir(), AGENT_BROWSER_SKILL_NAME));
    // A library skill that's on everywhere.
    createSkill({ name: 'mine', description: 'Mine.' });
    await installOutside('mine');
    // Linked in by another tool.
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-elsewhere-'));
    plainSkill(elsewhere, 'managed-elsewhere');
    fs.mkdirSync(agentsDir(), { recursive: true });
    fs.symlinkSync(path.join(elsewhere, 'managed-elsewhere'), path.join(agentsDir(), 'managed-elsewhere'));

    try {
      const outside = await listOutsideSkills();
      expect(outside.map((s) => s.name)).toEqual(['implementing-specs', 'managed-elsewhere']);
      expect(outside[0]).toMatchObject({
        channels: ['claude', 'agents'],
        linked: false,
        description: 'implementing-specs does things.',
        importBlocker: null,
      });
      expect(outside[1]).toMatchObject({ channels: ['agents'], linked: true, importBlocker: expect.stringMatching(/Another tool/) });
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('blocks importing over a library skill with the same name', async () => {
    plainSkill(claudeDir(), 'dupe');
    createSkill({ name: 'dupe', description: 'Ri copy.' });
    const [skill] = await listOutsideSkills();
    expect(skill.importBlocker).toMatch(/already has/);
  });
});

describe('importOutsideSkill', () => {
  it('moves the skill into the library and links it back where it was', async () => {
    plainSkill(claudeDir(), 'implementing-specs');
    fs.mkdirSync(path.join(claudeDir(), 'implementing-specs', 'references'));
    fs.writeFileSync(path.join(claudeDir(), 'implementing-specs', 'references', 'x.md'), 'ref');

    await importOutsideSkill('implementing-specs');

    const library = skillDir('implementing-specs');
    expect(fs.readFileSync(path.join(library, 'references', 'x.md'), 'utf8')).toBe('ref');
    expect(fs.readlinkSync(path.join(claudeDir(), 'implementing-specs'))).toBe(library);
    expect(fs.readlinkSync(path.join(agentsDir(), 'implementing-specs'))).toBe(library);
    const archived = fs.readdirSync(path.join(home.root, '.archive', 'skills-outside'));
    expect(archived).toEqual([expect.stringMatching(/^claude-implementing-specs-/)]);
    expect(await listOutsideSkills()).toEqual([]);
  });

  it('refuses a skill another tool links in', async () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-elsewhere-'));
    plainSkill(elsewhere, 'managed');
    fs.mkdirSync(claudeDir(), { recursive: true });
    fs.symlinkSync(path.join(elsewhere, 'managed'), path.join(claudeDir(), 'managed'));
    try {
      await expect(importOutsideSkill('managed')).rejects.toMatchObject({ code: 'invalid' });
      expect(fs.existsSync(skillDir('managed'))).toBe(false);
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('answers not_found for a name that is not out there', async () => {
    await expect(importOutsideSkill('nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('removeSessionLinks', () => {
  it("removes the links Codex left in chat folders, and only ours", async () => {
    createSkill({ name: 'triage', description: 'Triage.' });
    const appLinks = path.join(home.root, '.agents', 'skills');
    fs.mkdirSync(appLinks, { recursive: true });
    fs.symlinkSync(skillDir('triage'), path.join(appLinks, 'triage'));
    const other = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-skill-other-'));
    fs.symlinkSync(other, path.join(appLinks, 'someone-elses'));
    try {
      expect(await removeSessionLinks(['triage'])).toBe(1);
      expect(fs.existsSync(path.join(appLinks, 'triage'))).toBe(false);
      expect(fs.lstatSync(path.join(appLinks, 'someone-elses')).isSymbolicLink()).toBe(true);
    } finally {
      fs.rmSync(other, { recursive: true, force: true });
    }
  });
});
