/**
 * Lifecycle for skills shipped with the app.
 *
 * The app-root install is always present so orchestrator and content sessions
 * discover the skill from their own cwd. The user-level install is opt-in and
 * makes the same skill available to ordinary agent sessions in any project.
 * Project repositories are never an ownership location for shipped skills.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkillInstallResult, SkillRemoveResult } from '@agentex/agent';
import { getAppRoot } from '@/lib/config/paths';
import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';

async function loadAgentex() {
  return import('@agentex/agent');
}

function findPackageRoot(startDir: string): string {
  let dir = startDir;
  while (dir !== path.parse(dir).root) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error(`Could not find package.json walking up from ${startDir}`);
}

const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILLS_ROOT = path.join(findPackageRoot(MODULE_DIR), 'skills');
const SHIPPED_SKILL_NAMES = ['orchestrator'] as const;

export function shippedSkillDirs(): string[] {
  return SHIPPED_SKILL_NAMES.map((name) => path.join(SKILLS_ROOT, name));
}

export function getGlobalSkillPreference(): boolean | null {
  return readAuthConfig()?.globalSkillEnabled ?? null;
}

export async function installAppRootSkills(): Promise<SkillInstallResult> {
  const { installSkills } = await loadAgentex();
  return installSkills(shippedSkillDirs(), {
    location: 'workspace',
    cwd: getAppRoot(),
  });
}

export async function installGlobalSkills(): Promise<SkillInstallResult> {
  const { installSkills } = await loadAgentex();
  return installSkills(shippedSkillDirs(), { location: 'global' });
}

export async function removeAppRootSkills(): Promise<SkillRemoveResult> {
  const { removeSkills } = await loadAgentex();
  return removeSkills(shippedSkillDirs(), {
    location: 'workspace',
    cwd: getAppRoot(),
  });
}

export async function removeGlobalSkills(): Promise<SkillRemoveResult> {
  const { removeSkills } = await loadAgentex();
  return removeSkills(shippedSkillDirs(), { location: 'global' });
}

export type GlobalSkillEnabledResult = { enabled: true; install: SkillInstallResult };
export type GlobalSkillDisabledResult = { enabled: false; remove: SkillRemoveResult };
export type GlobalSkillConfigurationResult =
  | GlobalSkillEnabledResult
  | GlobalSkillDisabledResult;

/** Apply and persist the user's explicit global-skill choice. */
export function configureGlobalSkill(enabled: true): Promise<GlobalSkillEnabledResult>;
export function configureGlobalSkill(enabled: false): Promise<GlobalSkillDisabledResult>;
export function configureGlobalSkill(enabled: boolean): Promise<GlobalSkillConfigurationResult>;
export async function configureGlobalSkill(
  enabled: boolean,
): Promise<GlobalSkillConfigurationResult> {
  if (enabled) {
    const install = await installGlobalSkills();
    writeAuthConfig({ globalSkillEnabled: true });
    return { enabled: true, install };
  }

  const remove = await removeGlobalSkills();
  writeAuthConfig({ globalSkillEnabled: false });
  return { enabled: false, remove };
}

/**
 * Remove app-owned shipped-skill links left by older Codex session injection.
 * agentex removes only symlinks that resolve to our exact source directories.
 * Regular files, directories, and links to another skill are reported as
 * conflicts and left untouched.
 */
export async function removeOwnedProjectSkillLinks(cwd: string): Promise<SkillRemoveResult> {
  if (path.resolve(cwd) === path.resolve(getAppRoot())) {
    return { entries: [], removed: 0 };
  }
  const { removeSkills } = await loadAgentex();
  return removeSkills(shippedSkillDirs(), { location: 'workspace', cwd });
}
