/**
 * Skill operations as the app and agents see them: one place that keeps the
 * folder, its reach (database row and outside links), the links Codex leaves
 * in chat folders, and the skill's builder and try chats in step. The API
 * routes (src/app/api/skills) and the orchestrator actions (list_skills,
 * get_skill, save_skill, set_skill_reach) both call through here.
 */

import { archiveChatSession, clearSkillScope, getWorkspace, listSkillChats, listSkillScopes, renameSkillRecords, setSkillScope } from '@/lib/db/queries';
import fs from 'node:fs';
import path from 'node:path';
import { inventorySkills } from '@/lib/executor/skills';
import { SKILL_FILE, nameProblem, parseSkillFile, suggestSkillName, type SkillFields, type SkillProblem } from './format';
import {
  SkillError,
  archiveSkillFolder,
  createSkill,
  librarySkillNames,
  listLibrarySkills,
  readSkill,
  renameSkillFolder,
  requireSkill,
  skillExists,
  writeSkill,
  type SkillDocument,
  type SkillFileEntry,
  type SupportingFileWrite,
} from './library';
import {
  canReachOutside,
  importOutsideSkill,
  installOutside,
  listOutsideSkills,
  outsideLinkState,
  outsideLinkStates,
  removeOutside,
  removeSessionLinks,
  type OutsideLinkState,
  type OutsideSkill,
} from './outside';
import { getSkillReach, reachFrom, setSkillReach, type SkillReach } from './reach';

/**
 * The live-session side effects a skill change has: restarting a chat so it
 * picks up a new brief (after its turn, never mid-turn, since the builder AI
 * may be the one renaming), closing an archived skill's chats, and
 * restarting sessions after a reach change.
 * The executor adapter by default. Tests swap in spies (a dynamic import
 * from a source module isn't reliably mockable here).
 */
export interface SkillSessionControl {
  close(chatSessionId: string): Promise<unknown>;
  recycleWhenIdle(chatSessionId: string): Promise<void>;
  recycleWorkspaceSessions(workspaceId: string): Promise<void>;
  recycleEveryAgentSession(opts: { includeAppMainChat?: boolean }): Promise<void>;
}

let sessionControlOverride: SkillSessionControl | null = null;

async function sessionControl(): Promise<SkillSessionControl> {
  return sessionControlOverride ?? (await import('@/lib/executor/adapter'));
}

export function setSkillSessionControlForTests(control: SkillSessionControl | null): void {
  sessionControlOverride = control;
}

export interface SkillSummary {
  name: string;
  description: string | null;
  updatedAt: string;
  reach: SkillReach;
  /** Blocking problems (errors) exist: it can't be turned on until fixed. */
  hasErrors: boolean;
}

export interface FolderSkill {
  name: string;
  description: string | null;
}

export interface SkillsOverview {
  skills: SkillSummary[];
  /** With a workspace: the skills in its folder's .ri/skills, which always reach it. */
  folderSkills?: FolderSkill[];
  /** Skills in ~/.claude/skills or ~/.agents/skills that Ri doesn't own. */
  outside: OutsideSkill[];
  /** False in the desktop app, which leaves the user's other tools alone. */
  canReachOutside: boolean;
}

/** Skills in a folder's `.ri/skills`, which reach every chat that runs there. */
function folderSkillsOf(cwd: string): FolderSkill[] {
  return inventorySkills(cwd)
    .filter((entry) => entry.scope === 'workspace')
    .map((entry) => {
      let description: string | null = null;
      try {
        description = parseSkillFile(fs.readFileSync(path.join(entry.sourceDir, SKILL_FILE), 'utf8')).description;
      } catch {
        // Unreadable: listed without a description.
      }
      return { name: entry.name, description };
    });
}

export async function skillsOverview(opts: { workspaceId?: string | null } = {}): Promise<SkillsOverview> {
  const skills = listLibrarySkills();
  const scopes = new Map(listSkillScopes().map((row) => [row.name, row]));
  const links = await outsideLinkStates(skills.map((skill) => skill.name));
  const outside = canReachOutside() ? await listOutsideSkills() : [];
  const workspace = opts.workspaceId ? getWorkspace(opts.workspaceId) : null;
  return {
    ...(workspace?.cwd ? { folderSkills: folderSkillsOf(workspace.cwd) } : {}),
    skills: skills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      updatedAt: skill.updatedAt,
      reach: reachFrom(scopes.get(skill.name) ?? null, links.get(skill.name)?.installed ?? false),
      hasErrors: skill.problems.some((problem) => problem.level === 'error'),
    })),
    outside,
    canReachOutside: canReachOutside(),
  };
}

export interface SkillView {
  name: string;
  dir: string;
  content: string;
  hash: string;
  updatedAt: string;
  description: string | null;
  body: string;
  /** Frontmatter keys besides name and description, kept untouched by field edits. */
  otherKeys: string[];
  /** The frontmatter can't be edited as fields, only as the whole file. */
  frontmatterError: string | null;
  problems: SkillProblem[];
  files: SkillFileEntry[];
  reach: SkillReach;
  outside: OutsideLinkState;
  canReachOutside: boolean;
}

function toView(doc: SkillDocument, reach: SkillReach, outside: OutsideLinkState): SkillView {
  return {
    name: doc.name,
    dir: doc.dir,
    content: doc.content,
    hash: doc.hash,
    updatedAt: doc.updatedAt,
    description: doc.parsed.description,
    body: doc.parsed.body,
    otherKeys: doc.parsed.otherKeys,
    frontmatterError: doc.parsed.frontmatterError,
    problems: doc.problems,
    files: doc.files,
    reach,
    outside,
    canReachOutside: canReachOutside(),
  };
}

export async function getSkillView(name: string): Promise<SkillView | null> {
  const doc = readSkill(name);
  if (!doc) return null;
  const outside = await outsideLinkState(name);
  return toView(doc, reachFrom(listSkillScopes().find((row) => row.name === name) ?? null, outside.installed), outside);
}

async function requireView(name: string): Promise<SkillView> {
  const view = await getSkillView(name);
  if (!view) throw new SkillError('not_found', `There's no skill named ${name}.`);
  return view;
}

export interface NewSkillInput {
  /** The name to use. Without one, a name comes from `intent`. */
  name?: string;
  /** What the skill should do, in the user's words. Names the skill when `name` is absent. */
  intent?: string;
  description?: string;
  body?: string;
}

/**
 * Create a skill, off. Nothing gets it until someone turns it on, so a skill
 * being drafted (by hand or by the builder AI) never reaches a running agent
 * half-written.
 */
export async function newSkill(input: NewSkillInput): Promise<SkillView> {
  const name = input.name?.trim() || suggestSkillName(input.intent ?? '', librarySkillNames());
  createSkill({ name, description: input.description, body: input.body });
  setSkillScope(name, []);
  return requireView(name);
}

export interface SaveSkillInput {
  /** Rename the skill. Moves the folder, its reach, its links and its chats. */
  newName?: string;
  description?: string;
  body?: string;
  /** The whole SKILL.md. Wins over description and body. */
  content?: string;
  files?: SupportingFileWrite[];
  baseHash?: string | null;
}

export interface SaveSkillResult {
  skill: SkillView;
  /** Set when the save renamed the skill. */
  renamedFrom: string | null;
}

/**
 * Save a skill's content, and rename it when asked (or when whole-file
 * content carries a new `name:`). A new name is checked before anything is
 * written, so a bad rename changes nothing.
 */
export async function saveSkill(name: string, input: SaveSkillInput): Promise<SaveSkillResult> {
  requireSkill(name);
  let target = input.newName?.trim() || null;
  if (target === null && input.content !== undefined) {
    const parsed = parseSkillFile(input.content);
    if (parsed.frontmatterError === null && parsed.name && parsed.name !== name) target = parsed.name;
  }
  if (target !== null && target !== name) {
    const problem = nameProblem(target);
    if (problem) throw new SkillError('invalid', problem);
    if (skillExists(target)) throw new SkillError('conflict', `A skill named ${target} already exists.`);
  } else {
    target = null;
  }

  const fields: SkillFields = {};
  if (input.description !== undefined) fields.description = input.description;
  if (input.body !== undefined) fields.body = input.body;
  const hasFields = fields.description !== undefined || fields.body !== undefined;
  writeSkill(name, {
    ...(input.content !== undefined ? { content: input.content } : hasFields ? { fields } : {}),
    files: input.files,
    baseHash: input.baseHash ?? null,
  });

  if (target === null) return { skill: await requireView(name), renamedFrom: null };
  await renameSkill(name, target);
  return { skill: await requireView(target), renamedFrom: name };
}

/**
 * Rename a skill everywhere it lives: the folder (and `name:`), its reach
 * row, its builder and try chats, its outside links, and the links Codex
 * left under the old name. Live builder and try chats restart once their
 * current turn ends (the builder AI may be mid-turn, renaming it), so the
 * next message gets a brief with the new name.
 */
export async function renameSkill(from: string, to: string): Promise<SkillView> {
  if (from === to) return requireView(from);
  const wasOutside = (await outsideLinkState(from)).installed;
  // Links point at the old folder path, so they come down while it's still the source.
  await removeOutside(from);
  await removeSessionLinks([from]);
  renameSkillFolder(from, to);
  renameSkillRecords(from, to);
  if (wasOutside) await installOutside(to);
  await restartSkillChats(to);
  return requireView(to);
}

async function restartSkillChats(name: string): Promise<void> {
  const control = await sessionControl();
  await Promise.all(listSkillChats(name).map((chat) => control.recycleWhenIdle(chat.id).catch(() => {})));
}

/** Change where a skill reaches, then restart the live sessions the change affects. */
export async function changeSkillReach(name: string, next: SkillReach): Promise<SkillView> {
  const before = await getSkillReach(name);
  const after = await setSkillReach(name, next);
  await recycleForReachChange(before, after);
  return requireView(name);
}

/**
 * A harness reads its skill list when its session starts, so a reach change
 * restarts the sessions it touches (the next message resumes the same chat).
 * An agent-list change touches only the agents added or removed. A change
 * between some agents (or none) and every agent touches every agent's
 * sessions and the app's main chat, the same way a global reference folder
 * does.
 */
async function recycleForReachChange(before: SkillReach, after: SkillReach): Promise<void> {
  const control = await sessionControl();
  const ids = (reach: SkillReach) => (reach.mode === 'agents' ? reach.workspaceIds : []);
  const scoped = (reach: SkillReach) => reach.mode === 'agents' || reach.mode === 'off';
  try {
    if (scoped(before) && scoped(after)) {
      const a = new Set(ids(before));
      const b = new Set(ids(after));
      const changed = [...a, ...b].filter((id) => a.has(id) !== b.has(id) && getWorkspace(id));
      await Promise.all(changed.map((id) => control.recycleWorkspaceSessions(id)));
      return;
    }
    // Every agent had it before and has it now (in Ri, "everywhere" is still
    // every agent), so no session sees a difference.
    const everyAgent = (reach: SkillReach) => reach.mode === 'all' || reach.mode === 'everywhere';
    if (everyAgent(before) && everyAgent(after)) return;
    await control.recycleEveryAgentSession({ includeAppMainChat: true });
  } catch (err) {
    // The reach change stands. Sessions pick it up when they next start.
    console.warn('[skills] could not restart sessions after a reach change:', err);
  }
}

/**
 * Move a skill to `<app-root>/.archive/skills/`, where the home backup keeps
 * it: its links come down, its reach row goes, its builder and try chats are
 * archived. Returns where the folder went.
 */
export async function archiveSkill(name: string): Promise<{ archivedTo: string }> {
  requireSkill(name);
  const reach = await getSkillReach(name);
  await removeOutside(name);
  await removeSessionLinks([name]);
  const archivedTo = archiveSkillFolder(name);
  clearSkillScope(name);
  const control = await sessionControl();
  for (const chat of listSkillChats(name)) {
    await control.close(chat.id).catch(() => {});
    archiveChatSession(chat.id);
  }
  if (reach.mode !== 'off') await recycleForReachChange(reach, { mode: 'off' });
  return { archivedTo };
}

/** Import a skill from ~/.claude/skills or ~/.agents/skills. It stays on everywhere, as it was. */
export async function importSkill(name: string): Promise<SkillView> {
  await importOutsideSkill(name);
  clearSkillScope(name);
  return requireView(name);
}

export { SkillError };
