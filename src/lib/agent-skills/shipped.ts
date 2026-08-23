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
import { AGENT_SKILL_NAME, AGENT_BROWSER_SKILL_NAME } from '@/constants/app';
import { getAppRoot, getWorkDir } from '@/lib/config/paths';
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

/**
 * Shipped skills: a committed content template folder → the installed name.
 * The template folder name is incidental; the installed name is composed from
 * APP_SHORT_ID (see AGENT_SKILL_NAME) so a rebrand propagates from one place.
 * agentex names an installed skill after the source directory's basename, so
 * the source we hand it must already carry the composed name — hence the
 * materialization step below.
 */
const SHIPPED_SKILLS = [
  { template: 'orchestrator', name: AGENT_SKILL_NAME },
  { template: 'browser', name: AGENT_BROWSER_SKILL_NAME },
] as const;

/** Regenerable materialization root — never synced, safe to delete (self-heals). */
function generatedSkillsRoot(): string {
  return path.join(getWorkDir(), 'skills');
}

/** Read a committed skill template and substitute the composed installed name. */
function renderSkillMarkdown(templateDir: string, name: string): string {
  const src = path.join(SKILLS_ROOT, templateDir, 'SKILL.md');
  return fs.readFileSync(src, 'utf8').replaceAll('{{SKILL_NAME}}', name);
}

/** Installed names of the shipped skills (what shows in an agent's skill list). */
export function shippedSkillNames(): string[] {
  return SHIPPED_SKILLS.map((s) => s.name);
}

/**
 * Materialize each shipped skill into `.work/skills/<installed-name>/`, with the
 * `name:` frontmatter substituted from the template placeholder so the on-disk
 * name matches the directory (a Claude Code requirement). Lives in `.work`
 * (regenerable, gitignored, never synced) and outside the user-authored skill
 * roots the executor scans, so it stays "shipped" not "user-owned". Idempotent:
 * the write is skipped when content is unchanged. Returns the source dirs to
 * hand to agentex's install/remove. An in-place skill rename should go through
 * remove-then-install so stale symlinks don't linger.
 */
export function ensureShippedSkills(): string[] {
  const root = generatedSkillsRoot();
  const dirs: string[] = [];
  for (const skill of SHIPPED_SKILLS) {
    const outDir = path.join(root, skill.name);
    const outFile = path.join(outDir, 'SKILL.md');
    const rendered = renderSkillMarkdown(skill.template, skill.name);
    let current: string | null = null;
    try {
      current = fs.readFileSync(outFile, 'utf8');
    } catch {
      // Not materialized yet — fall through to write.
    }
    if (current !== rendered) {
      fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outFile, rendered);
    }
    dirs.push(outDir);
  }
  return dirs;
}

export function shippedSkillDirs(): string[] {
  return ensureShippedSkills();
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
