/**
 * Harness-agnostic skill discovery.
 *
 * Two new author-neutral roots, on top of the bundled skills shipped
 * with the app:
 *
 *   - Global:    `<brain>/skills/<name>/SKILL.md`
 *   - Workspace: `<workspace>/.flow/skills/<name>/SKILL.md` (when the
 *                session is bound to a workspace cwd)
 *
 * Workspace overrides global on name collision so a repo-specific
 * skill can shadow a brain-level one without surgery.
 *
 * The executor adapter doesn't render `SKILL.md` itself — it hands the
 * resolved source directories to `@agentex/agent`'s `skillDirs`
 * config, which translates discovery for the active harness. The shipped
 * orchestrator skill is deliberately excluded from this path because it is
 * installed at the app root or, after explicit opt-in, in the user's global
 * agent skill directories. Our job here is only to enumerate user-authored
 * global and workspace skills.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getBrainDir } from '@/lib/config/paths';

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

/**
 * Resolve the active skill set for a session. Workspace skills shadow
 * global skills by `name`. Returns the merged + deduped list.
 *
 * @param workspaceCwd  Working directory of the session's workspace,
 *                      or null for orchestrator/content sessions.
 */
export function resolveSkillsForSession(workspaceCwd: string | null): DiscoveredSkill[] {
  const global = readSkillDir(path.join(getBrainDir(), 'skills'), 'global');
  const workspace = workspaceCwd
    ? readSkillDir(path.join(workspaceCwd, '.flow', 'skills'), 'workspace')
    : [];
  // Workspace wins on collision.
  const byName = new Map<string, DiscoveredSkill>();
  for (const skill of global) byName.set(skill.name, skill);
  for (const skill of workspace) byName.set(skill.name, skill);
  return Array.from(byName.values());
}

/** Convenience: just the source-dir paths, the shape agentex's `skillDirs` wants. */
export function resolveSkillDirsForSession(workspaceCwd: string | null): string[] {
  return resolveSkillsForSession(workspaceCwd).map((s) => s.sourceDir);
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
  return resolveSkillsForSession(workspaceCwd).map((s) => ({
    name: s.name,
    scope: s.scope,
    sourceDir: s.sourceDir,
  }));
}
