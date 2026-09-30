/**
 * Harness-agnostic skill discovery.
 *
 * Two author-neutral roots, on top of the bundled skills shipped with the
 * app:
 *
 *   - Library:   `<app-root>/skills/<name>/SKILL.md`, the home's skill
 *                library, which the Plugins page builds and manages
 *                (docs/skills.md)
 *   - Workspace: `<workspace>/.ri/skills/<name>/SKILL.md` (when the
 *                session is bound to a workspace cwd)
 *
 * Workspace overrides library on name collision so a repo-specific
 * skill can shadow a library one without surgery.
 *
 * A library skill can be limited to some agents or turned off. The home
 * decides that per chat (src/lib/skills/reach.ts) and the session spec
 * carries the names to leave out, because the runner may be on another
 * device without the database. A library skill linked into both user-level
 * folders (~/.claude/skills and ~/.agents/skills, "on everywhere") is left
 * out too: every harness already reads it from there, and attaching it a
 * second time would list it twice.
 *
 * The executor adapter doesn't render `SKILL.md` itself — it hands the
 * resolved source directories to `@agentex/agent`'s `skillDirs`
 * config, which translates discovery for the active harness. The shipped
 * orchestrator skill is deliberately excluded from this path because it is
 * installed at the app root or, after explicit opt-in, in the user's global
 * agent skill directories. Our job here is only to enumerate user-authored
 * library and workspace skills.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { getAppRoot } from '@/lib/config/paths';

const SKILL_FILE = 'SKILL.md';

export interface DiscoveredSkill {
  /** SKILL frontmatter `name:` — used for collision resolution. */
  name: string;
  /** Absolute path to the skill's directory (the one that contains SKILL.md). */
  sourceDir: string;
  /** Where the skill came from. Used in logs and the `list_skills` action. */
  scope: 'global' | 'workspace';
}

/**
 * Walk a directory of `<name>/SKILL.md` entries. Returns each as a
 * `DiscoveredSkill`. Tolerates missing parent dirs (no-op) and read
 * errors (logs + returns empty) — a bad permission on one skill root
 * shouldn't kill session creation.
 */
function readSkillDir(root: string, scope: DiscoveredSkill['scope']): DiscoveredSkill[] {
  if (!fs.existsSync(root)) return [];
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch (err) {
    console.warn(`[skills] failed to enumerate ${root}:`, err);
    return [];
  }
  const out: DiscoveredSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourceDir = path.join(root, entry.name);
    const skillFile = path.join(sourceDir, SKILL_FILE);
    try {
      if (!fs.existsSync(skillFile)) continue;
    } catch {
      continue;
    }
    out.push({ name: entry.name, sourceDir, scope });
  }
  return out;
}

export interface ResolveSkillsOptions {
  /** Library skills this chat must not get, as the home decided (src/lib/skills/reach.ts). */
  exclude?: readonly string[];
  /** Whose ~/.claude/skills and ~/.agents/skills to check for links. Defaults to the user's home. */
  homeDir?: string;
}

function linksTo(link: string, target: string): boolean {
  try {
    if (!fs.lstatSync(link).isSymbolicLink()) return false;
    return path.resolve(path.dirname(link), fs.readlinkSync(link)) === path.resolve(target);
  } catch {
    return false;
  }
}

/** Linked into both user-level folders, so every harness already reads it on its own. */
function readByEveryHarness(skill: DiscoveredSkill, homeDir: string): boolean {
  return (
    linksTo(path.join(homeDir, '.claude', 'skills', skill.name), skill.sourceDir) &&
    linksTo(path.join(homeDir, '.agents', 'skills', skill.name), skill.sourceDir)
  );
}

function librarySkills(): DiscoveredSkill[] {
  return readSkillDir(path.join(getAppRoot(), 'skills'), 'global');
}

function workspaceSkills(workspaceCwd: string | null): DiscoveredSkill[] {
  return workspaceCwd ? readSkillDir(path.join(workspaceCwd, '.ri', 'skills'), 'workspace') : [];
}

function mergeByName(library: DiscoveredSkill[], workspace: DiscoveredSkill[]): DiscoveredSkill[] {
  // Workspace wins on collision.
  const byName = new Map<string, DiscoveredSkill>();
  for (const skill of library) byName.set(skill.name, skill);
  for (const skill of workspace) byName.set(skill.name, skill);
  return Array.from(byName.values());
}

/**
 * Resolve the skills to attach to a session. Workspace skills shadow
 * library skills by `name`. Returns the merged + deduped list.
 *
 * @param workspaceCwd  Working directory of the session's workspace,
 *                      or null for orchestrator/content sessions.
 */
export function resolveSkillsForSession(
  workspaceCwd: string | null,
  opts: ResolveSkillsOptions = {},
): DiscoveredSkill[] {
  const excluded = new Set(opts.exclude ?? []);
  const homeDir = opts.homeDir ?? os.homedir();
  const library = librarySkills().filter((skill) => !excluded.has(skill.name) && !readByEveryHarness(skill, homeDir));
  return mergeByName(library, workspaceSkills(workspaceCwd));
}

/** Convenience: just the source-dir paths, the shape agentex's `skillDirs` wants. */
export function resolveSkillDirsForSession(workspaceCwd: string | null, opts: ResolveSkillsOptions = {}): string[] {
  return resolveSkillsForSession(workspaceCwd, opts).map((s) => s.sourceDir);
}

/**
 * Inventory for the `list_skills` orchestrator action. Returns a
 * stable shape independent of the active session.
 */
export interface SkillInventoryEntry {
  name: string;
  scope: 'global' | 'workspace';
  sourceDir: string;
}

export function inventorySkills(workspaceCwd: string | null): SkillInventoryEntry[] {
  return mergeByName(librarySkills(), workspaceSkills(workspaceCwd)).map((s) => ({
    name: s.name,
    scope: s.scope,
    sourceDir: s.sourceDir,
  }));
}
