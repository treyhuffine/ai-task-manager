import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AGENT_SKILL_NAME } from '@/constants/app';
import { APP_ROOT_ENV } from '@/lib/config/paths';
import {
  configureGlobalSkill,
  getGlobalSkillPreference,
  installAppRootSkills,
  removeOwnedProjectSkillLinks,
  shippedSkillDirs,
} from './shipped';

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

    expect(result.installed).toBe(2);
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
  });

  it('persists an explicit global opt-in and installs both user-level channels', async () => {
    const result = await configureGlobalSkill(true);

    expect(result.enabled).toBe(true);
    expect(getGlobalSkillPreference()).toBe(true);
    for (const channel of ['.agents', '.claude']) {
      const link = path.join(tmpHome, channel, 'skills', AGENT_SKILL_NAME);
      expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
    }
  });

  it('removes the global links when the user opts out', async () => {
    await configureGlobalSkill(true);
    const result = await configureGlobalSkill(false);

    expect(result.enabled).toBe(false);
    expect(result.remove.removed).toBe(2);
    expect(getGlobalSkillPreference()).toBe(false);
    expect(fs.existsSync(path.join(tmpHome, '.agents', 'skills', AGENT_SKILL_NAME))).toBe(false);
    expect(fs.existsSync(path.join(tmpHome, '.claude', 'skills', AGENT_SKILL_NAME))).toBe(false);
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

    expect(result.removed).toBe(2);
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
