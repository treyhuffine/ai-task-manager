/**
 * Lifecycle for skills shipped with the app.
 *
 * The app-root install is always present so orchestrator and content sessions
 * discover the skill from their own cwd. The user-level install makes the same
 * skills available to ordinary coding-tool sessions in any project. First-run
 * setup turns it on unless the home already chose, and Settings (Get started,
 * External AI) shows it with one-click install and uninstall
 * (`src/components/settings/agent-skill-access.tsx`). Project repositories are
 * never an ownership location for shipped skills.
 */

import fs from 'node:fs';
import os from 'node:os';
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

/** Where the user-level install stands on disk, which can differ from the saved choice. */
export interface GlobalSkillStatus {
  /** Every shipped skill is linked from both user-level folders to this home's copy. */
  installed: boolean;
  /**
   * User-level entries holding something else under a shipped skill's name:
   * someone's own skill, or a link to another Ri home's live copy.
   * Installing leaves them alone, so they keep that skill from being
   * installed. A dead link isn't one: installing replaces it. Written the
   * way a person reads them, with `~` for the home folder.
   */
  conflicts: string[];
}

/** Read the user-level skill folders, never change them. */
export async function inspectGlobalSkills(): Promise<GlobalSkillStatus> {
  let installed = true;
  const conflicts: string[] = [];
  for (const { link, state } of await globalShippedEntries()) {
    if (state !== 'ours') installed = false;
    if (state === 'other') conflicts.push(displayHomePath(link));
  }
  return { installed, conflicts };
}

/** Each shipped skill's place in both user-level folders, and what's there now. */
async function globalShippedEntries(): Promise<Array<{ link: string; state: LinkState }>> {
  const { resolveSkillsHome } = await loadAgentex();
  const dirs = shippedSkillDirs();
  return [resolveSkillsHome('claude'), resolveSkillsHome('agents')].flatMap((skillsHome) =>
    dirs.map((dir) => {
      const link = path.join(skillsHome, path.basename(dir));
      return { link, state: linkState(link, dir) };
    }),
  );
}

/**
 * Clear dead links at the shipped names in the user-level folders: links
 * whose target is gone, left by a Ri home that no longer exists (a deleted
 * worktree's demo home, say). No coding tool can read one, and agentex
 * won't replace a link it didn't make, so without this the name stays taken
 * for good. Only the shipped names are looked at. Live links and real
 * folders stay.
 */
async function clearDeadGlobalLinks(): Promise<void> {
  for (const { link, state } of await globalShippedEntries()) {
    if (state === 'dead') fs.unlinkSync(link);
  }
}

/** A path the way a person reads it, `~` for the home folder. */
export function displayHomePath(p: string): string {
  const home = os.homedir();
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

type LinkState = 'ours' | 'missing' | 'dead' | 'other';

/**
 * Agentex's test before it installs or removes a link (a link to exactly this
 * source is ours), plus whether a link to anything else still leads anywhere.
 */
function linkState(link: string, source: string): LinkState {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(link);
  } catch {
    return 'missing';
  }
  if (!stat.isSymbolicLink()) return 'other';
  if (path.resolve(path.dirname(link), fs.readlinkSync(link)) === path.resolve(source)) return 'ours';
  return fs.existsSync(link) ? 'other' : 'dead';
}

export async function installAppRootSkills(): Promise<SkillInstallResult> {
  const { installSkills } = await loadAgentex();
  return installSkills(shippedSkillDirs(), {
    location: 'workspace',
    cwd: getAppRoot(),
  });
}

export async function installGlobalSkills(): Promise<SkillInstallResult> {
  await clearDeadGlobalLinks();
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
