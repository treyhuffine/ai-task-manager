import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_SKILL_NAME, AGENT_BROWSER_SKILL_NAME } from '@/constants/app';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import {
  configureGlobalSkill,
  getGlobalSkillPreference,
  globalSkillFolders,
  inspectGlobalSkills,
  installAppRootSkills,
  removeOwnedProjectSkillLinks,
  shippedSkillDirs,
} from './shipped';

const FOLDERS = ['~/.agents/skills', '~/.claude/skills', '~/.gemini/config/skills'];
const LINKED = ['.agents', '.claude'];
const COPIED = path.join('.gemini', 'config');
const CHANNELS = [...LINKED, COPIED];
const SKILLS = [AGENT_SKILL_NAME, AGENT_BROWSER_SKILL_NAME];
const MARKER = '.ri-home';

let tmpHome: string;
let appRoot: string;
let previousHome: string | undefined;
let previousRoot: string | undefined;

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'shipped-skills-test-'));
  appRoot = path.join(tmpHome, 'app-home');
  previousHome = process.env.HOME;
  previousRoot = process.env[APP_ROOT_ENV];
  process.env.HOME = tmpHome;
  process.env[APP_ROOT_ENV] = appRoot;
});

afterEach(() => {
  if (previousHome === undefined) delete process.env.HOME;
  else process.env.HOME = previousHome;
  if (previousRoot === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = previousRoot;
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe('shipped agent skills', () => {
  it('installs the app-owned skill into both app-root channels', async () => {
    const result = await installAppRootSkills();

    // Two shipped skills (orchestrator + browser) across two channels each.
    expect(result.installed).toBe(4);
    for (const channel of ['.agents', '.claude']) {
      const link = path.join(appRoot, channel, 'skills', AGENT_SKILL_NAME);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
      expect(fs.realpathSync(link)).toBe(fs.realpathSync(shippedSkillDirs()[0]));
    }

    // The materialized skill's frontmatter name is composed from the constant,
    // with no placeholder left behind — this is what a rebrand propagates.
    const materialized = fs.readFileSync(path.join(shippedSkillDirs()[0], 'SKILL.md'), 'utf8');
    expect(materialized).toContain(`name: ${AGENT_SKILL_NAME}`);
    expect(materialized).not.toContain('{{SKILL_NAME}}');

    // The browser skill materializes and installs the same way.
    const browserSkill = fs.readFileSync(path.join(shippedSkillDirs()[1], 'SKILL.md'), 'utf8');
    expect(browserSkill).toContain(`name: ${AGENT_BROWSER_SKILL_NAME}`);
    expect(browserSkill).not.toContain('{{SKILL_NAME}}');
    for (const channel of ['.agents', '.claude']) {
      const link = path.join(appRoot, channel, 'skills', AGENT_BROWSER_SKILL_NAME);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    }
  });

  it('goes in the every-project folder of each harness Ri runs, once each, linked where a link works', () => {
    // Codex, Cursor and OpenCode share .agents, Claude Code has .claude, and
    // Antigravity reads only its own config folder, and can't read a link there.
    expect(globalSkillFolders()).toEqual([
      { folder: path.join(tmpHome, '.agents', 'skills'), links: true },
      { folder: path.join(tmpHome, '.claude', 'skills'), links: true },
      { folder: path.join(tmpHome, '.gemini', 'config', 'skills'), links: false },
    ]);
  });

  it('persists an explicit global opt-in: links in the shared folders, marked copies for Antigravity', async () => {
    const result = await configureGlobalSkill(true);

    expect(result.enabled).toBe(true);
    expect(result.install).toMatchObject({ installed: 6, conflicts: 0, errors: 0 });
    expect(getGlobalSkillPreference()).toBe(true);
    for (const [i, name] of SKILLS.entries()) {
      for (const channel of LINKED) {
        const link = path.join(tmpHome, channel, 'skills', name);
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(link)).toBe(fs.realpathSync(shippedSkillDirs()[i]));
      }
      const copy = path.join(tmpHome, COPIED, 'skills', name);
      expect(fs.lstatSync(copy).isDirectory()).toBe(true);
      expect(fs.readFileSync(path.join(copy, 'SKILL.md'), 'utf8')).toBe(fs.readFileSync(path.join(shippedSkillDirs()[i], 'SKILL.md'), 'utf8'));
      expect(fs.readFileSync(path.join(copy, MARKER), 'utf8').trim()).toBe(appRoot);
    }
    // No staging folder is left beside the copies.
    expect(fs.readdirSync(path.join(tmpHome, COPIED, 'skills')).sort()).toEqual([...SKILLS].sort());
    // A second install has nothing to do.
    expect((await configureGlobalSkill(true)).install).toMatchObject({ installed: 0, skipped: 6 });
  });

  it('refreshes a copy that no longer matches this home\'s skill', async () => {
    await configureGlobalSkill(true);
    const skill = path.join(tmpHome, COPIED, 'skills', AGENT_SKILL_NAME, 'SKILL.md');
    fs.writeFileSync(skill, 'an older version');
    fs.writeFileSync(path.join(path.dirname(skill), 'leftover.md'), 'from an older version');
    // Still this home's, so still installed: it's usable, just behind.
    expect((await inspectGlobalSkills()).installed).toBe(true);

    expect((await configureGlobalSkill(true)).install).toMatchObject({ installed: 1, skipped: 5 });
    expect(fs.readFileSync(skill, 'utf8')).toBe(fs.readFileSync(path.join(shippedSkillDirs()[0], 'SKILL.md'), 'utf8'));
    expect(fs.existsSync(path.join(path.dirname(skill), 'leftover.md'))).toBe(false);
  });

  it('removes its links and copies when the user opts out, and nothing they point at', async () => {
    await configureGlobalSkill(true);
    const result = await configureGlobalSkill(false);

    expect(result.enabled).toBe(false);
    expect(result.remove.removed).toBe(6);
    expect(getGlobalSkillPreference()).toBe(false);
    for (const channel of CHANNELS) {
      for (const name of SKILLS) expect(fs.existsSync(path.join(tmpHome, channel, 'skills', name))).toBe(false);
    }
    for (const dir of shippedSkillDirs()) expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(true);
  });

  it('reports what is on disk, not the saved choice', async () => {
    expect(await inspectGlobalSkills()).toEqual({ installed: false, conflicts: [], folders: FOLDERS });

    await configureGlobalSkill(true);
    expect(await inspectGlobalSkills()).toEqual({ installed: true, conflicts: [], folders: FOLDERS });

    // A copy deleted by hand: still chosen, no longer installed, nothing in the way.
    fs.rmSync(path.join(tmpHome, COPIED, 'skills', AGENT_BROWSER_SKILL_NAME), { recursive: true });
    expect(getGlobalSkillPreference()).toBe(true);
    expect(await inspectGlobalSkills()).toEqual({ installed: false, conflicts: [], folders: FOLDERS });
  });

  it('names what holds a shipped skill name, and installing leaves it alone', async () => {
    const own = path.join(tmpHome, '.claude', 'skills', AGENT_SKILL_NAME);
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, 'SKILL.md'), 'user-owned');
    // Another live Ri home: its link in one folder, its copy in Antigravity's.
    const otherHome = path.join(tmpHome, 'other-home');
    const otherSkill = path.join(otherHome, '.work', 'skills', AGENT_SKILL_NAME);
    fs.mkdirSync(otherSkill, { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync(otherSkill, path.join(tmpHome, '.agents', 'skills', AGENT_SKILL_NAME), 'dir');
    const otherCopy = path.join(tmpHome, COPIED, 'skills', AGENT_SKILL_NAME);
    fs.mkdirSync(otherCopy, { recursive: true });
    fs.writeFileSync(path.join(otherCopy, 'SKILL.md'), 'the other home\'s');
    fs.writeFileSync(path.join(otherCopy, MARKER), otherHome);
    // Someone's own skill in Antigravity's folder, with no marker at all.
    const ownCopy = path.join(tmpHome, COPIED, 'skills', AGENT_BROWSER_SKILL_NAME);
    fs.mkdirSync(ownCopy, { recursive: true });
    fs.writeFileSync(path.join(ownCopy, 'SKILL.md'), 'user-owned browser');

    const result = await configureGlobalSkill(true);

    expect(result.install).toMatchObject({ conflicts: 4, installed: 2 });
    expect(await inspectGlobalSkills()).toEqual({
      installed: false,
      conflicts: [
        `~/.agents/skills/${AGENT_SKILL_NAME}`,
        `~/.claude/skills/${AGENT_SKILL_NAME}`,
        `~/.gemini/config/skills/${AGENT_SKILL_NAME}`,
        `~/.gemini/config/skills/${AGENT_BROWSER_SKILL_NAME}`,
      ],
      folders: FOLDERS,
    });

    // Uninstalling removes only this home's, so all four stay put.
    await configureGlobalSkill(false);
    expect(fs.readFileSync(path.join(own, 'SKILL.md'), 'utf8')).toBe('user-owned');
    expect(fs.readlinkSync(path.join(tmpHome, '.agents', 'skills', AGENT_SKILL_NAME))).toBe(otherSkill);
    expect(fs.readFileSync(path.join(otherCopy, 'SKILL.md'), 'utf8')).toBe('the other home\'s');
    expect(fs.readFileSync(path.join(ownCopy, 'SKILL.md'), 'utf8')).toBe('user-owned browser');
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', AGENT_BROWSER_SKILL_NAME))).toBe(false);
  });

  it('replaces a dead link, or a copy from a home that is gone, and only at a shipped name', async () => {
    const skills = path.join(tmpHome, '.claude', 'skills');
    fs.mkdirSync(skills, { recursive: true });
    const gone = path.join(tmpHome, 'deleted-worktree', '.work', 'skills', AGENT_SKILL_NAME);
    fs.symlinkSync(gone, path.join(skills, AGENT_SKILL_NAME), 'dir');
    fs.symlinkSync(path.join(tmpHome, 'nowhere'), path.join(skills, 'someone-elses'), 'dir');
    const staleCopy = path.join(tmpHome, COPIED, 'skills', AGENT_SKILL_NAME);
    fs.mkdirSync(staleCopy, { recursive: true });
    fs.writeFileSync(path.join(staleCopy, 'SKILL.md'), 'from a deleted home');
    fs.writeFileSync(path.join(staleCopy, MARKER), path.join(tmpHome, 'deleted-worktree'));

    // Not something to move by hand: not installed, and nothing in the way.
    expect(await inspectGlobalSkills()).toEqual({ installed: false, conflicts: [], folders: FOLDERS });

    const result = await configureGlobalSkill(true);

    expect(result.install.conflicts).toBe(0);
    expect(await inspectGlobalSkills()).toEqual({ installed: true, conflicts: [], folders: FOLDERS });
    expect(fs.realpathSync(path.join(skills, AGENT_SKILL_NAME))).toBe(fs.realpathSync(shippedSkillDirs()[0]));
    expect(fs.readFileSync(path.join(staleCopy, MARKER), 'utf8').trim()).toBe(appRoot);
    // A dead link under any other name is someone else's business.
    expect(fs.readlinkSync(path.join(skills, 'someone-elses'))).toBe(path.join(tmpHome, 'nowhere'));
  });

  it("swaps this home's link in Antigravity's folder, from before copies, for a copy", async () => {
    const folder = path.join(tmpHome, COPIED, 'skills');
    fs.mkdirSync(folder, { recursive: true });
    for (const dir of shippedSkillDirs()) fs.symlinkSync(dir, path.join(folder, path.basename(dir)), 'dir');

    // Listed by agy but unreadable, so not installed, and not in anyone's way.
    expect(await inspectGlobalSkills()).toMatchObject({ installed: false, conflicts: [] });

    await configureGlobalSkill(true);
    for (const name of SKILLS) {
      expect(fs.lstatSync(path.join(folder, name)).isDirectory()).toBe(true);
      expect(fs.readFileSync(path.join(folder, name, MARKER), 'utf8').trim()).toBe(appRoot);
    }
    expect((await inspectGlobalSkills()).installed).toBe(true);
    // The link's target, this home's own skill, is untouched.
    for (const dir of shippedSkillDirs()) expect(fs.existsSync(path.join(dir, 'SKILL.md'))).toBe(true);
  });

  it('removes a link from before copies on opt-out too', async () => {
    const folder = path.join(tmpHome, COPIED, 'skills');
    fs.mkdirSync(folder, { recursive: true });
    fs.symlinkSync(shippedSkillDirs()[0], path.join(folder, AGENT_SKILL_NAME), 'dir');

    await configureGlobalSkill(false);

    expect(fs.existsSync(path.join(folder, AGENT_SKILL_NAME))).toBe(false);
    expect(fs.existsSync(path.join(shippedSkillDirs()[0], 'SKILL.md'))).toBe(true);
  });

  it('removes only project links that point to the shipped skill', async () => {
    const project = path.join(tmpHome, 'project');
    await installAppRootSkills();
    const { installSkills } = await import('@agentex/agent');
    await installSkills(shippedSkillDirs(), { location: 'workspace', cwd: project });

    const unrelated = path.join(project, '.agents', 'skills', 'unrelated');
    fs.mkdirSync(unrelated, { recursive: true });
    fs.writeFileSync(path.join(unrelated, 'SKILL.md'), 'unrelated');

    const result = await removeOwnedProjectSkillLinks(project);

    expect(result.removed).toBe(4);
    expect(fs.existsSync(path.join(project, '.agents', 'skills', AGENT_SKILL_NAME))).toBe(false);
    expect(fs.existsSync(path.join(project, '.claude', 'skills', AGENT_SKILL_NAME))).toBe(false);
    expect(fs.existsSync(path.join(unrelated, 'SKILL.md'))).toBe(true);
  });

  it('leaves a conflicting project skill with the shipped name untouched', async () => {
    const project = path.join(tmpHome, 'project');
    const conflict = path.join(project, '.agents', 'skills', AGENT_SKILL_NAME);
    fs.mkdirSync(conflict, { recursive: true });
    fs.writeFileSync(path.join(conflict, 'SKILL.md'), 'user-owned');

    const result = await removeOwnedProjectSkillLinks(project);

    expect(result.entries.find((entry) => entry.target === 'agents')?.status).toBe('conflict');
    expect(fs.readFileSync(path.join(conflict, 'SKILL.md'), 'utf8')).toBe('user-owned');
  });
});
