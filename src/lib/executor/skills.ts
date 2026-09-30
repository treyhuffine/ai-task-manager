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
 * Global skills (~/.claude/skills, ~/.agents/skills) and a folder's project
 * skills (.claude/skills, .agents/skills) aren't attached here: every
 * harness reads those on its own. A skill's builder and try chats get a
 * little more or less, which the home decides and the session spec carries
 * (src/lib/skills/exclusions.ts), because the runner may be on another
 * device without the database. See docs/skills.md.
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
  /** Ri skills this chat must not get, as the home decided (src/lib/skills/exclusions.ts). */
  exclude?: readonly string[];
  /** Skill folders to attach on top of the usual ones, as the home decided. */
  extra?: readonly string[];
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
  const library = librarySkills().filter((skill) => !excluded.has(skill.name));
  const extra = (opts.extra ?? [])
    .filter((dir) => fs.existsSync(path.join(dir, SKILL_FILE)))
    .map((dir): DiscoveredSkill => ({ name: path.basename(dir), sourceDir: dir, scope: 'workspace' }));
  return mergeByName(library, [...workspaceSkills(workspaceCwd), ...extra]);
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
