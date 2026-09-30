/**
 * Where a skill lives, which is also who uses it. Three places, the same
 * ones Claude Code, Codex and the rest already use (docs/skills.md):
 *
 *   ri       <app-root>/skills/<name>. Every chat Ri runs gets it
 *            (src/lib/executor/skills.ts attaches it).
 *   global   ~/.claude/skills/<name>, linked into ~/.agents/skills. Every
 *            agent on this computer reads it on its own, in Ri and outside.
 *   project  <folder>/.claude/skills/<name>, linked into .agents/skills
 *            with a relative link. Agents working in that folder read it,
 *            and it's committed, so anyone who pulls the repo gets it too.
 *
 * `.claude/skills` is where each skill's folder really is. The `.agents/skills`
 * entry is a link to it, so Codex, Cursor, Gemini, OpenCode and Pi (which
 * read `.agents/skills`) see the same skill. A skill someone put only in
 * `.agents/skills` (or in a project's older `.ri/skills`) is found and edited
 * where it is.
 *
 * A skill is named by a ref: `ri:<name>`, `global:<name>` or
 * `project:<workspaceId>:<name>`. A bare name means `ri:<name>`.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { getAppRoot } from '@/lib/config/paths';
import { getWorkspace, listWorkspaces } from '@/lib/db/queries';
import { shippedSkillNames } from '@/lib/agent-skills/shipped';
import { SKILL_FILE } from './format';
import { SkillError, assertSafeFolderName, isSafeFolderName } from './library';

export type SkillLocation = { kind: 'ri' } | { kind: 'global' } | { kind: 'project'; workspaceId: string };
export type SkillLocationKind = SkillLocation['kind'];

export const RI: SkillLocation = { kind: 'ri' };
export const GLOBAL: SkillLocation = { kind: 'global' };

export function skillRef(location: SkillLocation, name: string): string {
  return location.kind === 'project' ? `project:${location.workspaceId}:${name}` : `${location.kind}:${name}`;
}

export function parseSkillRef(ref: string): { location: SkillLocation; name: string } | null {
  const parts = ref.split(':');
  if (parts.length === 1) return isSafeFolderName(parts[0]) ? { location: RI, name: parts[0] } : null;
  if ((parts[0] === 'ri' || parts[0] === 'global') && parts.length === 2 && isSafeFolderName(parts[1])) {
    return { location: parts[0] === 'ri' ? RI : GLOBAL, name: parts[1] };
  }
  if (parts[0] === 'project' && parts.length === 3 && parts[1] && isSafeFolderName(parts[2])) {
    return { location: { kind: 'project', workspaceId: parts[1] }, name: parts[2] };
  }
  return null;
}

export function sameLocation(a: SkillLocation, b: SkillLocation): boolean {
  return a.kind === b.kind && (a.kind !== 'project' || a.workspaceId === (b as { workspaceId: string }).workspaceId);
}

/** `<app-root>/skills`. */
export function riSkillsDir(): string {
  return path.join(getAppRoot(), 'skills');
}

/**
 * Whether this build may write outside the Ri home (global skills). The
 * desktop app keeps to itself and leaves the user's other tools alone, the
 * same rule the shipped skill follows.
 */
export function canWriteGlobal(): boolean {
  return process.env.RI_DESKTOP !== '1';
}

export interface ProjectInfo {
  workspaceId: string;
  /** The agent's name, which is what the user calls the project. */
  name: string;
  /** The agent's folder on this computer. */
  cwd: string;
  isGit: boolean;
}

/** Agents whose folder is on this computer: the projects a skill can live in. */
export function listProjects(): ProjectInfo[] {
  return listWorkspaces({ status: 'active' })
    .filter((ws) => ws.cwd && fs.existsSync(ws.cwd))
    .map((ws) => ({ workspaceId: ws.id, name: ws.name, cwd: ws.cwd!, isGit: ws.isGit }));
}

export function projectFor(workspaceId: string): ProjectInfo | null {
  const ws = getWorkspace(workspaceId);
  if (!ws || ws.status !== 'active' || !ws.cwd || !fs.existsSync(ws.cwd)) return null;
  return { workspaceId: ws.id, name: ws.name, cwd: ws.cwd, isGit: ws.isGit };
}

function requireProject(workspaceId: string): ProjectInfo {
  const project = projectFor(workspaceId);
  if (!project) throw new SkillError('not_found', "That agent's folder isn't on this computer.");
  return project;
}

interface Channels {
  /** Where new skills go and where a skill's folder really is. */
  primary: string;
  /** Linked to the primary, for the harnesses that read `.agents/skills`. */
  mirror: string | null;
  /** Also read, never written to except in place. */
  legacy: string[];
}

function channelsOf(location: SkillLocation): Channels {
  switch (location.kind) {
    case 'ri':
      return { primary: riSkillsDir(), mirror: null, legacy: [] };
    case 'global': {
      const home = os.homedir();
      return { primary: path.join(home, '.claude', 'skills'), mirror: path.join(home, '.agents', 'skills'), legacy: [] };
    }
    case 'project': {
      const { cwd } = requireProject(location.workspaceId);
      return {
        primary: path.join(cwd, '.claude', 'skills'),
        mirror: path.join(cwd, '.agents', 'skills'),
        legacy: [path.join(cwd, '.ri', 'skills')],
      };
    }
  }
}

export interface LocatedSkill {
  ref: string;
  name: string;
  location: SkillLocation;
  /** The folder holding SKILL.md. */
  dir: string;
  /**
   * A link another tool put in the global folder (it points somewhere Ri
   * doesn't manage). Shown, and usable by agents, but edited where it lives.
   */
  linkedFrom: string | null;
}

function hasSkillFile(dir: string): boolean {
  try {
    return fs.statSync(path.join(dir, SKILL_FILE)).isFile();
  } catch {
    return false;
  }
}

function linkTarget(entry: string): string | null {
  try {
    return path.resolve(path.dirname(entry), fs.readlinkSync(entry));
  } catch {
    return null;
  }
}

/** Every skill at a location. The primary folder wins a name found twice. */
export function listSkillsAt(location: SkillLocation): LocatedSkill[] {
  let channels: Channels;
  try {
    channels = channelsOf(location);
  } catch {
    return [];
  }
  const roots = [channels.primary, ...(channels.mirror ? [channels.mirror] : []), ...channels.legacy];
  const ours = new Set(roots.map((root) => path.resolve(root)));
  const shipped = location.kind === 'global' ? new Set(shippedSkillNames()) : null;
  const byName = new Map<string, LocatedSkill>();

  for (const root of roots) {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!isSafeFolderName(entry.name) || byName.has(entry.name)) continue;
      const full = path.join(root, entry.name);
      let linkedFrom: string | null = null;
      let dir = full;
      if (entry.isSymbolicLink()) {
        const target = linkTarget(full);
        // A mirror of a skill in this location: listed once, from its folder.
        if (!target || ours.has(path.dirname(target))) continue;
        // Only the global folder holds links worth showing: other tools
        // install skills there that way. Ri's own shipped skills and old
        // links into Ri's skills aren't separate skills. In a project or
        // Ri's folder, an outside link is left over from a session.
        if (location.kind !== 'global' || shipped?.has(entry.name)) continue;
        if (path.dirname(target) === path.resolve(riSkillsDir())) continue;
        linkedFrom = target;
        dir = target;
      } else if (!entry.isDirectory()) {
        continue;
      }
      if (!hasSkillFile(dir)) continue;
      byName.set(entry.name, { ref: skillRef(location, entry.name), name: entry.name, location, dir, linkedFrom });
    }
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Every skill Ri can see: its own, the global ones, and each project's. */
export function listAllSkills(): LocatedSkill[] {
  return [
    ...listSkillsAt(RI),
    ...listSkillsAt(GLOBAL),
    ...listProjects().flatMap((project) => listSkillsAt({ kind: 'project', workspaceId: project.workspaceId })),
  ];
}

export function findSkill(ref: string): LocatedSkill | null {
  const parsed = parseSkillRef(ref);
  if (!parsed) return null;
  return listSkillsAt(parsed.location).find((skill) => skill.name === parsed.name) ?? null;
}

export function requireLocatedSkill(ref: string): LocatedSkill {
  const skill = findSkill(ref);
  if (!skill) {
    const name = parseSkillRef(ref)?.name ?? ref;
    throw new SkillError('not_found', `There's no skill named ${name} there.`);
  }
  return skill;
}

/** A name is taken at a location when any of its folders has an entry by that name. */
export function nameTakenAt(location: SkillLocation, name: string): boolean {
  assertSafeFolderName(name);
  const channels = channelsOf(location);
  return [channels.primary, ...(channels.mirror ? [channels.mirror] : []), ...channels.legacy].some((root) => {
    try {
      fs.lstatSync(path.join(root, name));
      return true;
    } catch {
      return false;
    }
  });
}

/** Where a new skill named `name` goes at a location. */
export function newSkillDir(location: SkillLocation, name: string): string {
  assertSafeFolderName(name);
  if (location.kind === 'global' && !canWriteGlobal()) {
    throw new SkillError('invalid', 'The desktop app keeps skills inside Ri and leaves your other tools alone.');
  }
  return path.join(channelsOf(location).primary, name);
}

/**
 * Link a skill's folder into the location's mirror (`.agents/skills`), so
 * every harness finds it. Relative inside a project, so the link works in
 * any clone of the repo. Leaves an existing entry alone.
 */
export function linkMirror(location: SkillLocation, dir: string): void {
  const channels = channelsOf(location);
  if (!channels.mirror || path.dirname(dir) !== path.resolve(channels.primary)) return;
  const link = path.join(channels.mirror, path.basename(dir));
  try {
    fs.lstatSync(link);
    return;
  } catch {
    // Not there yet.
  }
  fs.mkdirSync(channels.mirror, { recursive: true });
  const target = location.kind === 'project' ? path.relative(channels.mirror, dir) : dir;
  fs.symlinkSync(target, link, 'dir');
}

/** Remove the mirror link for a skill folder, only when it points at that folder. */
export function unlinkMirror(location: SkillLocation, dir: string): void {
  let channels: Channels;
  try {
    channels = channelsOf(location);
  } catch {
    return;
  }
  if (!channels.mirror) return;
  const link = path.join(channels.mirror, path.basename(dir));
  if (linkTarget(link) === path.resolve(dir)) fs.rmSync(link, { force: true });
}

/**
 * For a project skill: its paths relative to the project folder (the folder
 * and its mirror link), which is what a commit covers.
 */
export function projectPaths(skill: LocatedSkill): { cwd: string; paths: string[] } | null {
  if (skill.location.kind !== 'project') return null;
  const { cwd } = requireProject(skill.location.workspaceId);
  const channels = channelsOf(skill.location);
  const candidates = [path.join(channels.primary, skill.name), ...(channels.mirror ? [path.join(channels.mirror, skill.name)] : [])];
  const inside = skill.dir.startsWith(cwd + path.sep) ? [skill.dir] : [];
  const paths = [...new Set([...inside, ...candidates])].map((p) => path.relative(cwd, p));
  return { cwd, paths };
}
