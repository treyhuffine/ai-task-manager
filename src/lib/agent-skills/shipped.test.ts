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
const CHANNELS = ['.agents', '.claude', path.join('.gemini', 'config')];

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

  it('goes in the every-project folder of each harness Ri runs, once each', () => {
    // Codex, Cursor and OpenCode share .agents, Claude Code has .claude, and
    // Antigravity reads only its own config folder.
    expect(globalSkillFolders()).toEqual(CHANNELS.map((channel) => path.join(tmpHome, channel, 'skills')));
  });

  it('persists an explicit global opt-in and installs into every user-level folder', async () => {
    const result = await configureGlobalSkill(true);

    expect(result.enabled).toBe(true);
    expect(result.install).toMatchObject({ installed: 6, conflicts: 0, errors: 0 });
    expect(getGlobalSkillPreference()).toBe(true);
    for (const channel of CHANNELS) {
      for (const [i, name] of [AGENT_SKILL_NAME, AGENT_BROWSER_SKILL_NAME].entries()) {
        const link = path.join(tmpHome, channel, 'skills', name);
        expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
        expect(fs.realpathSync(link)).toBe(fs.realpathSync(shippedSkillDirs()[i]));
      }
    }
    // A second install has nothing to do.
    expect((await configureGlobalSkill(true)).install).toMatchObject({ installed: 0, skipped: 6 });
  });

  it('removes the global links when the user opts out', async () => {
    await configureGlobalSkill(true);
    const result = await configureGlobalSkill(false);

    expect(result.enabled).toBe(false);
    expect(result.remove.removed).toBe(6);
    expect(getGlobalSkillPreference()).toBe(false);
    for (const channel of CHANNELS) {
      expect(fs.existsSync(path.join(tmpHome, channel, 'skills', AGENT_SKILL_NAME))).toBe(false);
    }
  });

  it('reports what is on disk, not the saved choice', async () => {
    expect(await inspectGlobalSkills()).toEqual({ installed: false, conflicts: [], folders: FOLDERS });

    await configureGlobalSkill(true);
    expect(await inspectGlobalSkills()).toEqual({ installed: true, conflicts: [], folders: FOLDERS });

    // A link deleted by hand: still chosen, no longer installed, nothing in the way.
    fs.unlinkSync(path.join(tmpHome, '.gemini', 'config', 'skills', AGENT_BROWSER_SKILL_NAME));
    expect(getGlobalSkillPreference()).toBe(true);
    expect(await inspectGlobalSkills()).toEqual({ installed: false, conflicts: [], folders: FOLDERS });
  });

  it('names what holds a shipped skill name, and installing leaves it alone', async () => {
    const own = path.join(tmpHome, '.claude', 'skills', AGENT_SKILL_NAME);
    fs.mkdirSync(own, { recursive: true });
    fs.writeFileSync(path.join(own, 'SKILL.md'), 'user-owned');
    // Another Ri home's copy, linked from the other channel.
    const otherHome = path.join(tmpHome, 'other-home', AGENT_SKILL_NAME);
    fs.mkdirSync(otherHome, { recursive: true });
    fs.mkdirSync(path.join(tmpHome, '.agents', 'skills'), { recursive: true });
    fs.symlinkSync(otherHome, path.join(tmpHome, '.agents', 'skills', AGENT_SKILL_NAME), 'dir');

    const result = await configureGlobalSkill(true);

    expect(result.install).toMatchObject({ conflicts: 2, installed: 4 });
    expect(await inspectGlobalSkills()).toEqual({
      installed: false,
      conflicts: [`~/.agents/skills/${AGENT_SKILL_NAME}`, `~/.claude/skills/${AGENT_SKILL_NAME}`],
      folders: FOLDERS,
    });
    expect(fs.readFileSync(path.join(own, 'SKILL.md'), 'utf8')).toBe('user-owned');

    // Uninstalling removes only Ri's own links, so the other two stay put.
    await configureGlobalSkill(false);
    expect(fs.readFileSync(path.join(own, 'SKILL.md'), 'utf8')).toBe('user-owned');
    expect(fs.readlinkSync(path.join(tmpHome, '.agents', 'skills', AGENT_SKILL_NAME))).toBe(otherHome);
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', AGENT_BROWSER_SKILL_NAME))).toBe(false);
  });

  it('replaces a dead link a deleted home left at a shipped name, and only that', async () => {
    const skills = path.join(tmpHome, '.claude', 'skills');
    fs.mkdirSync(skills, { recursive: true });
    const gone = path.join(tmpHome, 'deleted-worktree', '.work', 'skills', AGENT_SKILL_NAME);
    fs.symlinkSync(gone, path.join(skills, AGENT_SKILL_NAME), 'dir');
    fs.symlinkSync(path.join(tmpHome, 'nowhere'), path.join(skills, 'someone-elses'), 'dir');

    // Not something to move by hand: not installed, and nothing in the way.
    expect(await inspectGlobalSkills()).toEqual({ installed: false, conflicts: [], folders: FOLDERS });

    const result = await configureGlobalSkill(true);

    expect(result.install.conflicts).toBe(0);
    expect(await inspectGlobalSkills()).toEqual({ installed: true, conflicts: [], folders: FOLDERS });
    expect(fs.realpathSync(path.join(skills, AGENT_SKILL_NAME))).toBe(fs.realpathSync(shippedSkillDirs()[0]));
    // A dead link under any other name is someone else's business.
    expect(fs.readlinkSync(path.join(skills, 'someone-elses'))).toBe(path.join(tmpHome, 'nowhere'));
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
