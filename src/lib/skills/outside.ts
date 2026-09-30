/**
 * Skills outside Ri: the user-level folders every harness reads on its own,
 * `~/.claude/skills` (Claude Code) and `~/.agents/skills` (Codex, Cursor,
 * Gemini, OpenCode, Pi). agentex owns those paths and the link mechanics.
 *
 * Three jobs:
 *
 *   - Put a library skill there ("also outside Ri"). agentex links the
 *     library folder into both, so later edits carry over and removal only
 *     ever touches links that point at our folder.
 *   - List what's already there that Ri doesn't own, like a skill written
 *     for Claude Code by hand, so the Plugins page shows the whole picture.
 *   - Import one of those into the library: copy it in, archive the original,
 *     and link the library copy back in its place, so Claude Code (and now
 *     every other harness) keeps finding it and Ri owns the one copy.
 *
 * Link removal also runs over the folders Ri runs chats in, because Codex
 * attaches a session's skills by linking them into `<cwd>/.agents/skills`,
 * and those links outlive the session. When a skill stops reaching an agent,
 * its leftover links go too.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { InstalledSkill, SkillInstallResult } from '@agentex/agent';
import { getAppRoot } from '@/lib/config/paths';
import { shippedSkillNames } from '@/lib/agent-skills/shipped';
import { listChatSessions, listWorkspaces } from '@/lib/db/queries';
import { SKILL_FILE, isValidSkillName, parseSkillFile } from './format';
import { SkillError, archiveFolder, librarySkillsDir, requireSkill, skillDir, skillExists } from './library';

// agentex ships ESM only; dynamic import keeps CJS resolvers happy (see src/cli/commands/skills.ts).
async function loadAgentex() {
  return import('@agentex/agent');
}

export type OutsideChannel = 'claude' | 'agents';
const CHANNELS: readonly OutsideChannel[] = ['claude', 'agents'];

/**
 * Whether this build may write outside the app. The desktop app keeps agent
 * access inside itself and leaves the user's CLI setup alone, the same rule
 * the shipped skill follows (src/app/api/harness/skills/global/route.ts).
 */
export function canReachOutside(): boolean {
  return process.env.RI_DESKTOP !== '1';
}

function samePath(a: string, b: string): boolean {
  return path.resolve(a) === path.resolve(b);
}

export interface OutsideLinkState {
  /** Linked into both channels, pointing at the library folder. */
  installed: boolean;
  /** Channels linked to the library folder. */
  channels: OutsideChannel[];
  /** Channels holding a different skill under the same name. */
  conflicts: OutsideChannel[];
}

async function listGlobal(): Promise<Record<OutsideChannel, InstalledSkill[]>> {
  const { listInstalledSkills } = await loadAgentex();
  const installed = await listInstalledSkills({ location: 'global' });
  return { claude: installed.claude ?? [], agents: installed.agents ?? [] };
}

function linkStateFrom(global: Record<OutsideChannel, InstalledSkill[]>, name: string): OutsideLinkState {
  const dir = skillDir(name);
  const channels: OutsideChannel[] = [];
  const conflicts: OutsideChannel[] = [];
  for (const channel of CHANNELS) {
    const entry = global[channel].find((skill) => skill.name === name);
    if (!entry) continue;
    if (entry.isSymlink && entry.sourcePath && samePath(entry.sourcePath, dir)) channels.push(channel);
    else conflicts.push(channel);
  }
  return { installed: channels.length === CHANNELS.length, channels, conflicts };
}

/** Outside-Ri state for every library skill, from one read of the two folders. */
export async function outsideLinkStates(names: readonly string[]): Promise<Map<string, OutsideLinkState>> {
  const global = await listGlobal();
  return new Map(names.map((name) => [name, linkStateFrom(global, name)]));
}

export async function outsideLinkState(name: string): Promise<OutsideLinkState> {
  return linkStateFrom(await listGlobal(), name);
}

function channelLabel(channel: OutsideChannel): string {
  return channel === 'claude' ? '~/.claude/skills' : '~/.agents/skills';
}

/** Link a library skill into both user-level folders. Refuses to replace someone else's skill. */
export async function installOutside(name: string): Promise<SkillInstallResult> {
  if (!canReachOutside()) {
    throw new SkillError('invalid', 'The desktop app keeps skills inside Ri and leaves your other tools alone.');
  }
  requireSkill(name);
  const state = await outsideLinkState(name);
  if (state.conflicts.length > 0) {
    throw new SkillError(
      'conflict',
      `A different skill named ${name} is already in ${state.conflicts.map(channelLabel).join(' and ')}. Rename this one, or import that one into Ri.`,
    );
  }
  const { installSkills } = await loadAgentex();
  const result = await installSkills([skillDir(name)], { location: 'global' });
  const failed = result.entries.find((entry) => entry.status === 'error' || entry.status === 'conflict');
  if (failed) {
    throw new SkillError('conflict', failed.error ?? `Couldn't link ${name} into ${failed.targetPath}.`);
  }
  return result;
}

/** Remove the library skill's user-level links. Leaves anything else under that name alone. */
export async function removeOutside(name: string): Promise<void> {
  const { removeSkills } = await loadAgentex();
  await removeSkills([skillDir(name)], { location: 'global' });
}

/**
 * Folders Ri runs chats in: the app root (main and content chats), every
 * agent's folder, and every execution worktree. Where Codex may have left a
 * session's skill links.
 */
function chatFolders(): string[] {
  const dirs = new Set<string>([getAppRoot()]);
  try {
    for (const status of ['active', 'archived'] as const) {
      for (const workspace of listWorkspaces({ status })) if (workspace.cwd) dirs.add(workspace.cwd);
    }
    for (const session of listChatSessions({ type: 'execution' })) {
      if (session.worktreePath) dirs.add(session.worktreePath);
    }
  } catch {
    // The app root alone still covers the main and content chats.
  }
  return [...dirs];
}

/**
 * Remove links that session attachment left for these skills in the folders
 * Ri runs chats in. Only links resolving to the exact library folder go.
 * Best effort: a folder that's gone or unreadable is skipped.
 */
export async function removeSessionLinks(names: readonly string[]): Promise<number> {
  if (names.length === 0) return 0;
  const { removeSkills } = await loadAgentex();
  const dirs = names.map((name) => skillDir(name));
  let removed = 0;
  for (const cwd of chatFolders()) {
    if (!fs.existsSync(cwd)) continue;
    try {
      removed += (await removeSkills(dirs, { location: 'workspace', cwd })).removed;
    } catch {
      // Skip a folder we can't clean.
    }
  }
  return removed;
}

// ─── Skills Ri doesn't own ────────────────────────────────────

export interface OutsideSkill {
  name: string;
  description: string | null;
  /** Which user-level folders have it. */
  channels: OutsideChannel[];
  /** Where its SKILL.md lives: the folder, or a link's target. */
  dir: string;
  /** A link to somewhere else, so another tool manages it. */
  linked: boolean;
  /** Why it can't be imported, or null when it can. */
  importBlocker: string | null;
}

/**
 * Skills in the user-level folders that Ri doesn't own: not a library link,
 * not one of Ri's shipped skills, and a real skill (a folder without SKILL.md,
 * like Claude Desktop's `synced` container, isn't one).
 */
export async function listOutsideSkills(): Promise<OutsideSkill[]> {
  const global = await listGlobal();
  const library = librarySkillsDir();
  const shipped = new Set(shippedSkillNames());
  const byName = new Map<string, OutsideSkill>();
  for (const channel of CHANNELS) {
    for (const entry of global[channel]) {
      if (shipped.has(entry.name) || !entry.sourcePath) continue;
      if (entry.isSymlink && path.dirname(path.resolve(entry.sourcePath)) === path.resolve(library)) continue;
      let content: string;
      try {
        content = fs.readFileSync(path.join(entry.sourcePath, SKILL_FILE), 'utf8');
      } catch {
        continue;
      }
      const existing = byName.get(entry.name);
      if (existing) {
        existing.channels.push(channel);
        continue;
      }
      byName.set(entry.name, {
        name: entry.name,
        description: parseSkillFile(content).description,
        channels: [channel],
        dir: entry.sourcePath,
        linked: entry.isSymlink,
        importBlocker: null,
      });
    }
  }
  const skills = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const skill of skills) skill.importBlocker = importBlocker(skill);
  return skills;
}

function importBlocker(skill: OutsideSkill): string | null {
  if (!canReachOutside()) return 'The desktop app leaves your other tools alone.';
  if (skill.linked) return 'Another tool links this one in, so it stays managed there.';
  if (!isValidSkillName(skill.name)) return 'Its folder name breaks the skill naming rules, so rename it first.';
  if (skillExists(skill.name)) return `Ri already has a skill named ${skill.name}.`;
  return null;
}

/**
 * Bring an outside skill into the library. Copies the folder in, moves each
 * original into `<app-root>/.archive/skills-outside/`, and links the library
 * copy back into both user-level folders, so it keeps working everywhere it
 * did and Ri holds the one copy. If linking fails, the originals go back.
 */
export async function importOutsideSkill(name: string): Promise<void> {
  const skill = (await listOutsideSkills()).find((entry) => entry.name === name);
  if (!skill) throw new SkillError('not_found', `There's no skill named ${name} outside Ri.`);
  if (skill.importBlocker) throw new SkillError('invalid', skill.importBlocker);

  const { resolveSkillsHome } = await loadAgentex();
  const target = skillDir(name);
  fs.mkdirSync(librarySkillsDir(), { recursive: true });
  fs.cpSync(skill.dir, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });

  const moved: Array<{ from: string; to: string }> = [];
  try {
    for (const channel of skill.channels) {
      const original = path.join(resolveSkillsHome(channel), name);
      moved.push({ from: original, to: archiveFolder(original, 'skills-outside', `${channel}-${name}`) });
    }
    await installOutside(name);
  } catch (err) {
    await removeOutside(name).catch(() => {});
    for (const { from, to } of moved.reverse()) {
      try {
        fs.renameSync(to, from);
      } catch {
        // Leave it in the archive; nothing is lost.
      }
    }
    fs.rmSync(target, { recursive: true, force: true });
    throw err;
  }
}
