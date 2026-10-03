/**
 * Skill operations as the app and agents see them. A skill is a folder in one
 * of four places (./locations.ts): the drafts, where every new skill is
 * written, or installed in Ri's skills, the global skills, or a project's.
 * Installing is moving out of the drafts, and uninstalling is moving back.
 * Everything here keeps the folder, its `.agents/skills` link and the
 * skill's builder and try chats in step. The API routes (src/app/api/skills)
 * and the orchestrator actions (list_skills, get_skill, create_skill,
 * save_skill, move_skill) both call through here.
 */

import path from 'node:path';
import { archiveChatSession, listSkillChats, renameSkillChats, skillHasChatHistory } from '@/lib/db/queries';
import { nameProblem, parseSkillFile, suggestSkillName, type SkillFields, type SkillProblem } from './format';
import {
  SkillError,
  archiveFolder,
  copySkillFolder,
  createSkillAt,
  isBlankSkillAt,
  moveSkillFolder,
  readSkillAt,
  requireSkillAt,
  writeSkillAt,
  type SkillFileEntry,
  type SupportingFileWrite,
} from './library';
import {
  DRAFT,
  canWriteGlobal,
  findSkill,
  isInstalled,
  linkMirror,
  listAllSkills,
  listProjects,
  listSkillsAt,
  nameTakenAt,
  newSkillDir,
  parseSkillRef,
  projectFor,
  projectPaths,
  requireLocatedSkill,
  sameLocation,
  skillRef,
  unlinkMirror,
  type LocatedSkill,
  type ProjectInfo,
  type SkillLocation,
} from './locations';
import { commitSkillPaths, currentBranch, isGitRepo, uncommittedSkillNames, type SkillCommit } from './git';

/**
 * The live-session side effects a skill change has: restarting a skill's
 * builder and try chats so they pick up a new brief (after their turn, never
 * mid-turn, since the builder AI may be the one renaming), and closing an
 * archived skill's chats. The executor adapter by default. Tests swap in
 * spies (a dynamic import from a source module isn't reliably mockable here).
 */
export interface SkillSessionControl {
  close(chatSessionId: string): Promise<unknown>;
  recycleWhenIdle(chatSessionId: string): Promise<void>;
}

let sessionControlOverride: SkillSessionControl | null = null;

async function sessionControl(): Promise<SkillSessionControl> {
  return sessionControlOverride ?? (await import('@/lib/executor/adapter'));
}

export function setSkillSessionControlForTests(control: SkillSessionControl | null): void {
  sessionControlOverride = control;
}

export type SkillLocationView =
  | { kind: 'draft' }
  | { kind: 'ri' }
  | { kind: 'global' }
  | { kind: 'project'; workspaceId: string; projectName: string; cwd: string; isGit: boolean };

export interface SkillSummary {
  ref: string;
  name: string;
  location: SkillLocationView;
  description: string | null;
  updatedAt: string;
  /** False for a skill another tool links into the global folder. */
  editable: boolean;
  /** Where a linked skill really lives. */
  linkedFrom: string | null;
  /** Something's wrong in SKILL.md that stops agents using it well. */
  hasErrors: boolean;
  /** A project skill with changes the repo hasn't committed. */
  uncommitted: boolean;
}

export interface SkillsOverview {
  skills: SkillSummary[];
  /** Agents whose folder is on this computer: where a project skill can go. */
  projects: ProjectInfo[];
  /** False in the desktop app, which leaves the user's other tools alone. */
  canWriteGlobal: boolean;
}

function locationView(location: SkillLocation, projects: Map<string, ProjectInfo>): SkillLocationView {
  if (location.kind !== 'project') return location;
  const project = projects.get(location.workspaceId) ?? projectFor(location.workspaceId);
  return {
    kind: 'project',
    workspaceId: location.workspaceId,
    projectName: project?.name ?? 'A project',
    cwd: project?.cwd ?? '',
    isGit: project?.isGit ?? false,
  };
}

function summarize(skill: LocatedSkill, projects: Map<string, ProjectInfo>, uncommitted: boolean): SkillSummary | null {
  const doc = readSkillAt(skill.dir);
  if (!doc) return null;
  return {
    ref: skill.ref,
    name: skill.name,
    location: locationView(skill.location, projects),
    description: doc.description,
    updatedAt: doc.updatedAt,
    editable: skill.linkedFrom === null,
    linkedFrom: skill.linkedFrom,
    hasErrors: doc.problems.some((problem) => problem.level === 'error'),
    uncommitted,
  };
}

/** Uncommitted skill names per project, one `git status` per project that has skills. */
async function uncommittedByProject(skills: LocatedSkill[], projects: ProjectInfo[]): Promise<Map<string, Set<string>>> {
  const withSkills = new Set(skills.flatMap((s) => (s.location.kind === 'project' ? [s.location.workspaceId] : [])));
  const entries = await Promise.all(
    projects
      .filter((p) => p.isGit && withSkills.has(p.workspaceId))
      .map(async (p) => [p.workspaceId, await uncommittedSkillNames(p.cwd)] as const),
  );
  return new Map(entries);
}

export async function skillsOverview(): Promise<SkillsOverview> {
  const projects = listProjects();
  const byId = new Map(projects.map((p) => [p.workspaceId, p]));
  const located = listAllSkills();
  const dirty = await uncommittedByProject(located, projects);
  const skills = located
    .map((skill) =>
      summarize(
        skill,
        byId,
        skill.location.kind === 'project' ? (dirty.get(skill.location.workspaceId)?.has(skill.name) ?? false) : false,
      ),
    )
    .filter((s): s is SkillSummary => s !== null);
  return { skills, projects, canWriteGlobal: canWriteGlobal() };
}

export interface SkillView extends SkillSummary {
  dir: string;
  content: string;
  hash: string;
  body: string;
  /** Frontmatter keys besides name and description, kept untouched by field edits. */
  otherKeys: string[];
  /** The frontmatter can't be edited as fields, only as the whole file. */
  frontmatterError: string | null;
  problems: SkillProblem[];
  files: SkillFileEntry[];
  /** For a project skill in a git repo: the branch a commit would land on. */
  git: { branch: string | null } | null;
  canWriteGlobal: boolean;
}

async function viewOf(skill: LocatedSkill): Promise<SkillView> {
  const doc = requireSkillAt(skill.dir);
  const projects = new Map(listProjects().map((p) => [p.workspaceId, p]));
  let uncommitted = false;
  let git: SkillView['git'] = null;
  const project = skill.location.kind === 'project' ? projects.get(skill.location.workspaceId) : undefined;
  if (project && (await isGitRepo(project.cwd))) {
    uncommitted = (await uncommittedSkillNames(project.cwd)).has(skill.name);
    git = { branch: await currentBranch(project.cwd) };
  }
  return {
    ref: skill.ref,
    name: skill.name,
    location: locationView(skill.location, projects),
    description: doc.parsed.description,
    updatedAt: doc.updatedAt,
    editable: skill.linkedFrom === null,
    linkedFrom: skill.linkedFrom,
    hasErrors: doc.problems.some((problem) => problem.level === 'error'),
    uncommitted,
    dir: doc.dir,
    content: doc.content,
    hash: doc.hash,
    body: doc.parsed.body,
    otherKeys: doc.parsed.otherKeys,
    frontmatterError: doc.parsed.frontmatterError,
    problems: doc.problems,
    files: doc.files,
    git,
    canWriteGlobal: canWriteGlobal(),
  };
}

export async function getSkillView(ref: string): Promise<SkillView | null> {
  const skill = findSkill(ref);
  return skill ? viewOf(skill) : null;
}

function requireEditable(skill: LocatedSkill): void {
  if (skill.linkedFrom) {
    throw new SkillError('invalid', `${skill.name} is linked in from ${skill.linkedFrom}, so edit it there. Or copy it into Ri.`);
  }
}

export interface NewSkillInput {
  /** The name to use. Without one, a name comes from `intent`. */
  name?: string;
  /** What the skill should do, in the user's words. Names the skill when `name` is absent. */
  intent?: string;
  description?: string;
  body?: string;
  /** Where it goes. A draft by default, which no agent uses until it's installed. */
  location?: SkillLocation;
}

/**
 * A draft nobody has written in or talked about, to hand out again instead
 * of starting another. Opening New skill and walking away leaves at most one.
 */
function blankDraft(): LocatedSkill | null {
  return listSkillsAt(DRAFT).find((skill) => isBlankSkillAt(skill.dir) && !skillHasChatHistory(skill.ref)) ?? null;
}

/**
 * Create a skill. It's a draft unless `location` installs it somewhere, and
 * live where it lands, the way a skill folder is anywhere. An empty new
 * draft reuses a blank one if there is one.
 */
export async function newSkill(input: NewSkillInput): Promise<SkillView> {
  const location = input.location ?? DRAFT;
  const empty = !input.name?.trim() && !input.intent?.trim() && !input.description?.trim() && !input.body?.trim();
  if (empty && location.kind === 'draft') {
    const blank = blankDraft();
    if (blank) return viewOf(blank);
  }
  const taken = new Set(listSkillsAt(location).map((s) => s.name));
  const name = input.name?.trim() || suggestSkillName(input.intent ?? '', taken);
  if (nameTakenAt(location, name)) throw new SkillError('conflict', `A skill named ${name} is already there.`);
  const dir = newSkillDir(location, name);
  createSkillAt(dir, { description: input.description, body: input.body });
  linkMirror(location, dir);
  return viewOf(requireLocatedSkill(skillRef(location, name)));
}

export interface SaveSkillInput {
  /** Rename the skill (and its slash command), in the same place. */
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
  /** The skill's ref before the save, when the save renamed it. */
  renamedFrom: string | null;
}

/**
 * Save a skill's content, and rename it when asked (or when whole-file
 * content carries a new `name:`). A new name is checked before anything is
 * written, so a bad rename changes nothing.
 */
export async function saveSkill(ref: string, input: SaveSkillInput): Promise<SaveSkillResult> {
  const skill = requireLocatedSkill(ref);
  requireEditable(skill);
  let target = input.newName?.trim() || null;
  if (target === null && input.content !== undefined) {
    const parsed = parseSkillFile(input.content);
    if (parsed.frontmatterError === null && parsed.name && parsed.name !== skill.name) target = parsed.name;
  }
  if (target !== null && target !== skill.name) {
    const problem = nameProblem(target);
    if (problem) throw new SkillError('invalid', problem);
    if (nameTakenAt(skill.location, target)) throw new SkillError('conflict', `A skill named ${target} is already there.`);
  } else {
    target = null;
  }

  const fields: SkillFields = {};
  if (input.description !== undefined) fields.description = input.description;
  if (input.body !== undefined) fields.body = input.body;
  const hasFields = fields.description !== undefined || fields.body !== undefined;
  writeSkillAt(skill.dir, {
    ...(input.content !== undefined ? { content: input.content } : hasFields ? { fields } : {}),
    files: input.files,
    baseHash: input.baseHash ?? null,
  });

  if (target === null) return { skill: await viewOf(skill), renamedFrom: null };
  const renamed = await renameSkill(ref, target);
  return { skill: renamed, renamedFrom: skill.ref };
}

/** Carry a skill's builder and try chats to its new ref, and restart them once their turn ends. */
async function followChats(fromRef: string, toRef: string): Promise<void> {
  const legacy = parseSkillRef(fromRef)?.location.kind === 'ri' ? parseSkillRef(fromRef)!.name : null;
  renameSkillChats([fromRef, ...(legacy ? [legacy] : [])], toRef);
  const control = await sessionControl();
  await Promise.all(listSkillChats(toRef).map((chat) => control.recycleWhenIdle(chat.id).catch(() => {})));
}

/** Rename a skill where it is: its folder, `name:`, its `.agents/skills` link and its chats. */
export async function renameSkill(ref: string, newName: string): Promise<SkillView> {
  const skill = requireLocatedSkill(ref);
  requireEditable(skill);
  if (newName === skill.name) return viewOf(skill);
  if (nameTakenAt(skill.location, newName)) throw new SkillError('conflict', `A skill named ${newName} is already there.`);
  unlinkMirror(skill.location, skill.dir);
  const moved = moveSkillFolder(skill.dir, path.join(path.dirname(skill.dir), newName));
  linkMirror(skill.location, moved.dir);
  const toRef = skillRef(skill.location, newName);
  await followChats(skill.ref, toRef);
  return viewOf(requireLocatedSkill(toRef));
}

/**
 * Move a skill to another place, or copy it there and leave the original,
 * which is how a skill is shared with a project's team. Moving a draft to
 * Ri, global or a project installs it, and moving a skill to the drafts
 * uninstalls it. Keeps the name. Refuses if the name is taken there, and
 * refuses to install a skill with something wrong in it, since agents
 * would load it as it is.
 */
export async function moveSkill(ref: string, to: SkillLocation, opts: { copy?: boolean } = {}): Promise<SkillView> {
  const skill = requireLocatedSkill(ref);
  if (sameLocation(skill.location, to)) {
    throw new SkillError('invalid', `${skill.name} is already there.`);
  }
  if (!opts.copy) requireEditable(skill);
  if (isInstalled(to)) {
    const error = requireSkillAt(skill.dir).problems.find((problem) => problem.level === 'error');
    if (error) throw new SkillError('invalid', `Fix this before installing ${skill.name}. ${error.message}`);
  }
  if (nameTakenAt(to, skill.name)) {
    throw new SkillError('conflict', `There's already a skill named ${skill.name} there. Rename one of them first.`);
  }
  const dir = newSkillDir(to, skill.name);
  if (opts.copy) {
    copySkillFolder(skill.dir, dir);
  } else {
    unlinkMirror(skill.location, skill.dir);
    moveSkillFolder(skill.dir, dir);
  }
  linkMirror(to, dir);
  const toRef = skillRef(to, skill.name);
  if (!opts.copy) await followChats(skill.ref, toRef);
  return viewOf(requireLocatedSkill(toRef));
}

/**
 * Move a skill to `<app-root>/.archive/skills/`, where the home backup keeps
 * it, and archive its builder and try chats. Returns where the folder went.
 */
export async function archiveSkill(ref: string): Promise<{ archivedTo: string }> {
  const skill = requireLocatedSkill(ref);
  requireEditable(skill);
  unlinkMirror(skill.location, skill.dir);
  const label = skill.location.kind === 'project' ? `project-${skill.name}` : `${skill.location.kind}-${skill.name}`;
  const archivedTo = archiveFolder(skill.dir, 'skills', label);
  const control = await sessionControl();
  for (const chat of listSkillChats(skill.ref)) {
    await control.close(chat.id).catch(() => {});
    archiveChatSession(chat.id);
  }
  return { archivedTo };
}

/** Commit a project skill's files in its repo, and only them. */
export async function commitSkill(ref: string): Promise<{ skill: SkillView; commit: SkillCommit }> {
  const skill = requireLocatedSkill(ref);
  const where = projectPaths(skill);
  if (!where) throw new SkillError('invalid', 'Only a project skill lives in a repo.');
  const commit = await commitSkillPaths(where.cwd, skill.name, where.paths);
  return { skill: await viewOf(skill), commit };
}

export { SkillError };
