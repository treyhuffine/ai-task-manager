/**
 * Lifecycle for skills shipped with the app.
 *
 * The app-root install is always present so orchestrator and content sessions
 * discover the skill from their own cwd. The user-level install makes the same
 * skills available to ordinary coding-tool sessions in any project, for every
 * harness Ri can run. First-run setup turns it on as the conversation opens,
 * unless the home already chose, and Settings (Get started, MCP access)
 * shows it with one-click install and uninstall
 * (`src/components/settings/agent-skill-access.tsx`). Project repositories are
 * never an ownership location for shipped skills.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SkillInstallEntry, SkillInstallResult, SkillRemoveEntry, SkillRemoveResult } from '@agentex/agent';
import { AGENT_SKILL_NAME, AGENT_BROWSER_SKILL_NAME, APP_SHORT_ID } from '@/constants/app';
import { getAppRoot, getWorkDir } from '@/lib/config/paths';
import { HARNESS_REGISTRY, KNOWN_HARNESS_IDS } from '@/lib/harness/registry';
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

/**
 * The user-level folders Ri's skills go in: each harness's folder for skills
 * in every project (`globalSkills` in the harness registry), once each, and
 * whether the skills go there as links or copies. Every harness Ri can run,
 * not just the default, so one switched to later already has them. A folder
 * shared by harnesses gets copies if any of them can't use a link.
 */
export function globalSkillFolders(): Array<{ folder: string; links: boolean }> {
  const home = os.homedir();
  const folders = new Map<string, boolean>();
  for (const id of KNOWN_HARNESS_IDS) {
    const { dir, links } = HARNESS_REGISTRY[id].globalSkills;
    const folder = path.join(home, dir);
    folders.set(folder, (folders.get(folder) ?? true) && links);
  }
  return [...folders].map(([folder, links]) => ({ folder, links }));
}

/** Where the user-level install stands on disk, which can differ from the saved choice. */
export interface GlobalSkillStatus {
  /** Every shipped skill is in every user-level folder, as this home's link or copy. */
  installed: boolean;
  /**
   * User-level entries holding something else under a shipped skill's name:
   * someone's own skill, or another live Ri home's link or copy. Installing
   * leaves them alone, so they keep that skill from being installed. A dead
   * link, or a copy from a home that's gone, isn't one: installing replaces it.
   */
  conflicts: string[];
  /** The folders the skills go in. Paths here are written with `~` for the home folder. */
  folders: string[];
}

/** Read the user-level skill folders, never change them. */
export async function inspectGlobalSkills(): Promise<GlobalSkillStatus> {
  let installed = true;
  const conflicts: string[] = [];
  for (const { dest, state } of globalShippedEntries()) {
    if (state !== 'ours') installed = false;
    if (state === 'other') conflicts.push(displayHomePath(dest));
  }
  return { installed, conflicts, folders: globalSkillFolders().map(({ folder }) => displayHomePath(folder)) };
}

/** Each shipped skill's place in every user-level folder, and what's there now. */
function globalShippedEntries() {
  const dirs = shippedSkillDirs();
  return globalSkillFolders().flatMap(({ folder, links }) =>
    dirs.map((source) => {
      const dest = path.join(folder, path.basename(source));
      return { folder, links, source, dest, state: entryState(dest, source, links) };
    }),
  );
}

/** A path the way a person reads it, `~` for the home folder. */
export function displayHomePath(p: string): string {
  const home = os.homedir();
  return p.startsWith(`${home}/`) ? `~${p.slice(home.length)}` : p;
}

/**
 * Marks a copied skill folder as one home's, so status and uninstall can tell
 * it from someone's own skill of that name or another home's copy. Holds the
 * home's path.
 */
const COPY_MARKER = `.${APP_SHORT_ID}-home`;

/**
 * What's at a shipped skill's name in a user-level folder:
 * - `ours`: this home's skill, linked or copied as the folder takes it.
 * - `replace`: this home's skill in the other form (a link where a copy
 *   belongs, from before copies), so not usable as it is.
 * - `missing`: nothing.
 * - `dead`: a link that leads nowhere, or a copy marked with a home that's
 *   gone. Nothing can be using it, so installing replaces it.
 * - `other`: something live that isn't this home's.
 * A link to exactly this home's copy counts as its, the test agentex applies.
 */
type EntryState = 'ours' | 'replace' | 'missing' | 'dead' | 'other';

function entryState(dest: string, source: string, links: boolean): EntryState {
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(dest);
  } catch {
    return 'missing';
  }
  if (stat.isSymbolicLink()) {
    if (path.resolve(path.dirname(dest), fs.readlinkSync(dest)) === path.resolve(source)) return links ? 'ours' : 'replace';
    return fs.existsSync(dest) ? 'other' : 'dead';
  }
  const home = stat.isDirectory() ? readCopyMarker(dest) : null;
  if (home === null) return 'other';
  if (path.resolve(home) === path.resolve(getAppRoot())) return links ? 'replace' : 'ours';
  return fs.existsSync(home) ? 'other' : 'dead';
}

function readCopyMarker(dir: string): string | null {
  try {
    return fs.readFileSync(path.join(dir, COPY_MARKER), 'utf8').trim() || null;
  } catch {
    return null;
  }
}

/**
 * Copy this home's materialized skill to `dest` with the home's marker, or
 * leave it when it already matches. Built beside it and swapped in, so a
 * harness reading the folder never finds half a skill.
 */
function writeCopy(source: string, dest: string): 'created' | 'skipped' {
  const home = getAppRoot();
  if (readCopyMarker(dest) === home && sameFiles(source, dest)) return 'skipped';
  const staging = path.join(path.dirname(dest), `.${path.basename(dest)}.${process.pid}.tmp`);
  fs.rmSync(staging, { recursive: true, force: true });
  fs.cpSync(source, staging, { recursive: true, dereference: true });
  fs.writeFileSync(path.join(staging, COPY_MARKER), `${home}\n`);
  fs.rmSync(dest, { recursive: true, force: true });
  fs.renameSync(staging, dest);
  return 'created';
}

/** The copy holds exactly the source's files, byte for byte, besides its marker. */
function sameFiles(source: string, dest: string): boolean {
  const files = (dir: string) =>
    (fs.readdirSync(dir, { recursive: true }) as string[])
      .filter((file) => file !== COPY_MARKER && fs.statSync(path.join(dir, file)).isFile())
      .sort();
  try {
    const wanted = files(source);
    const have = files(dest);
    return wanted.length === have.length
      && wanted.every((file, i) => file === have[i]
        && fs.readFileSync(path.join(source, file)).equals(fs.readFileSync(path.join(dest, file))));
  } catch {
    return false;
  }
}

export async function installAppRootSkills(): Promise<SkillInstallResult> {
  const { installSkills } = await loadAgentex();
  return installSkills(shippedSkillDirs(), {
    location: 'workspace',
    cwd: getAppRoot(),
  });
}

/**
 * Put the shipped skills in every user-level folder, as links or copies as
 * each folder takes them, with agentex's own idempotent link. Copies are
 * refreshed when this home's skill changed, so a restart after an update
 * carries it. A dead link or a copy from a gone home at a shipped name is
 * replaced (nothing can read it, and agentex won't replace what it didn't
 * make, so it would keep the name taken for good), and this home's skill in
 * the other form is swapped for the right one. Anything live and not this
 * home's stays, as a conflict.
 */
export async function installGlobalSkills(): Promise<SkillInstallResult> {
  const { ensureSkillSymlink } = await loadAgentex();
  const entries: SkillInstallEntry[] = [];
  for (const { folder, links, source, dest, state } of globalShippedEntries()) {
    const entry = { target: folder, skillName: path.basename(source), targetPath: dest };
    if (state === 'other') {
      entries.push({ ...entry, status: 'conflict' });
      continue;
    }
    try {
      if (state === 'dead' || state === 'replace') fs.rmSync(dest, { recursive: true, force: true });
      fs.mkdirSync(folder, { recursive: true });
      entries.push({ ...entry, status: links ? await ensureSkillSymlink(source, dest) : writeCopy(source, dest) });
    } catch (err) {
      entries.push({ ...entry, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }
  const count = (status: SkillInstallEntry['status']) => entries.filter((e) => e.status === status).length;
  return { entries, installed: count('created'), skipped: count('skipped'), conflicts: count('conflict'), errors: count('error') };
}

export async function removeAppRootSkills(): Promise<SkillRemoveResult> {
  const { removeSkills } = await loadAgentex();
  return removeSkills(shippedSkillDirs(), {
    location: 'workspace',
    cwd: getAppRoot(),
  });
}

/** Remove only this home's links and copies. Anything else under a shipped name stays. */
export async function removeGlobalSkills(): Promise<SkillRemoveResult> {
  const entries: SkillRemoveEntry[] = [];
  for (const { folder, source, dest, state } of globalShippedEntries()) {
    const entry = { target: folder, skillName: path.basename(source), targetPath: dest };
    if (state !== 'ours' && state !== 'replace') {
      entries.push({ ...entry, status: state === 'missing' ? 'not_found' : 'conflict' });
      continue;
    }
    try {
      // A link goes, never what it points at: rm doesn't follow links.
      fs.rmSync(dest, { recursive: true, force: true });
      entries.push({ ...entry, status: 'removed' });
    } catch (err) {
      entries.push({ ...entry, status: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { entries, removed: entries.filter((e) => e.status === 'removed').length };
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
