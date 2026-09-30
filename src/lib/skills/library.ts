/**
 * File work on one skill folder (`<folder>/SKILL.md` plus supporting files),
 * wherever it lives: Ri's skills, the global skills, or a project's
 * (./locations.ts decides the folder). Three guards:
 *
 *   - Names are checked before they touch a path, so a name can never climb
 *     out of the folder it belongs in.
 *   - SKILL.md is written atomically (temp file, then rename), so a harness
 *     reading the skill mid-save sees the old file or the new one.
 *   - Writes can carry the hash of the file they were based on. A stale hash
 *     is refused with the current file, which is how the editor and the
 *     builder AI edit the same skill without overwriting each other.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { getAppRoot } from '@/lib/config/paths';
import {
  SKILL_FILE,
  checkSkill,
  nameProblem,
  parseSkillFile,
  renderSkillFile,
  type ParsedSkillFile,
  type SkillFields,
  type SkillProblem,
} from './format';

export class SkillError extends Error {
  constructor(
    public code: 'not_found' | 'invalid' | 'conflict' | 'stale',
    message: string,
    /** For `stale`: the skill as it is now, so the caller can merge or reload. */
    public current?: SkillDocument,
  ) {
    super(message);
    this.name = 'SkillError';
  }
}

/**
 * A folder name safe to join onto a skills path. Looser than the Agent
 * Skills name rules on purpose: a hand-made folder with a capital letter is
 * still readable (and the builder says what to fix), it just can't escape.
 */
export function isSafeFolderName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !name.startsWith('.') &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  );
}

export function assertSafeFolderName(name: string): void {
  if (!isSafeFolderName(name)) throw new SkillError('invalid', `"${name}" isn't a skill name Ri can use.`);
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export interface SkillFileEntry {
  /** Relative to the skill folder, with forward slashes. */
  path: string;
  size: number;
}

export interface SkillDocument {
  /** The folder name: the skill's identity, `name:` and slash command. */
  name: string;
  /** Absolute path to the folder. */
  dir: string;
  description: string | null;
  /** When SKILL.md last changed, ISO. */
  updatedAt: string;
  problems: SkillProblem[];
  /** The whole SKILL.md. */
  content: string;
  /** Hash of `content`, to send back with the next write. */
  hash: string;
  parsed: ParsedSkillFile;
  /** Everything else in the folder (references/, scripts/, assets/, ...). */
  files: SkillFileEntry[];
}

const MAX_LISTED_FILES = 200;

function listSupportingFiles(dir: string): SkillFileEntry[] {
  const out: SkillFileEntry[] = [];
  const walk = (current: string, rel: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (out.length >= MAX_LISTED_FILES) return;
      if (entry.name.startsWith('.')) continue;
      const relPath = rel ? `${rel}/${entry.name}` : entry.name;
      if (!rel && entry.name === SKILL_FILE) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full, relPath);
      else if (entry.isFile()) {
        try {
          out.push({ path: relPath, size: fs.statSync(full).size });
        } catch {
          // Vanished mid-walk.
        }
      }
    }
  };
  walk(dir, '');
  return out;
}

/** The skill in this folder, or null when there's no readable SKILL.md. */
export function readSkillAt(dir: string): SkillDocument | null {
  const name = path.basename(dir);
  const file = path.join(dir, SKILL_FILE);
  let content: string;
  let mtime: Date;
  try {
    content = fs.readFileSync(file, 'utf8');
    mtime = fs.statSync(file).mtime;
  } catch {
    return null;
  }
  const parsed = parseSkillFile(content);
  return {
    name,
    dir,
    description: parsed.description,
    updatedAt: mtime.toISOString(),
    problems: checkSkill(parsed, name),
    content,
    hash: hashContent(content),
    parsed,
    files: listSupportingFiles(dir),
  };
}

export function requireSkillAt(dir: string): SkillDocument {
  const skill = readSkillAt(dir);
  if (!skill) throw new SkillError('not_found', `There's no skill named ${path.basename(dir)}.`);
  return skill;
}

export function writeAtomic(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${randomBytes(4).toString('hex')}.tmp`);
  fs.writeFileSync(tmp, content);
  try {
    fs.renameSync(tmp, file);
  } catch (err) {
    fs.rmSync(tmp, { force: true });
    throw err;
  }
}

export interface CreateSkillInput {
  description?: string;
  body?: string;
}

/** Create a skill in a new folder `dir`, named after it. Refuses a bad name or an existing folder. */
export function createSkillAt(dir: string, input: CreateSkillInput = {}): SkillDocument {
  const name = path.basename(dir);
  const problem = nameProblem(name);
  if (problem) throw new SkillError('invalid', problem);
  if (fs.existsSync(dir)) throw new SkillError('conflict', `A skill named ${name} is already there.`);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(
    path.join(dir, SKILL_FILE),
    renderSkillFile(null, { name, description: input.description ?? '', body: input.body ?? '' }),
  );
  return requireSkillAt(dir);
}

export interface SupportingFileWrite {
  /** Relative path inside the skill folder, like references/api.md. */
  path: string;
  /** New text, or null to delete the file. */
  content: string | null;
}

export interface WriteSkillInput {
  /** Replace SKILL.md whole (the editor's file view). Wins over `fields`. */
  content?: string;
  /** Change fields, keeping everything else in the file. */
  fields?: SkillFields;
  /** Other files in the folder to write or delete. */
  files?: SupportingFileWrite[];
  /** The hash the change was based on. A mismatch is refused as stale. */
  baseHash?: string | null;
}

const MAX_SUPPORTING_FILE_BYTES = 1024 * 1024;

/** Resolve a supporting file path inside the folder, or throw. */
export function resolveSupportingPath(dir: string, relPath: string): string {
  const normalized = relPath.replace(/\\/g, '/').trim();
  const segments = normalized.split('/');
  if (
    !normalized ||
    normalized.startsWith('/') ||
    /^[a-zA-Z]:/.test(normalized) ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..' || segment.startsWith('.'))
  ) {
    throw new SkillError('invalid', `"${relPath}" isn't a file path inside the skill. Use one like references/guide.md.`);
  }
  if (normalized === SKILL_FILE) {
    throw new SkillError('invalid', 'Change SKILL.md through its fields or content, not as a supporting file.');
  }
  const full = path.join(dir, ...segments);
  if (!full.startsWith(dir + path.sep)) throw new SkillError('invalid', `"${relPath}" is outside the skill.`);
  return full;
}

/** Change a skill's SKILL.md and supporting files. */
export function writeSkillAt(dir: string, input: WriteSkillInput): SkillDocument {
  const current = requireSkillAt(dir);
  // Check every file path before writing anything, so a bad one fails the whole change.
  const planned = (input.files ?? []).map((file) => {
    if (file.content !== null && Buffer.byteLength(file.content) > MAX_SUPPORTING_FILE_BYTES) {
      throw new SkillError('invalid', `${file.path} is over 1 MB. Keep supporting files small, they cost context.`);
    }
    return { ...file, full: resolveSupportingPath(dir, file.path) };
  });

  let next = current.content;
  if (input.content !== undefined) next = input.content;
  else if (input.fields) next = renderSkillFile(current.content, input.fields);

  if (input.baseHash && input.baseHash !== current.hash) {
    // A retry of a write that already landed would change nothing, so it
    // isn't a conflict. Anything else would overwrite someone's edit.
    const alreadyApplied = next === current.content && planned.every((file) => fileHolds(file.full, file.content));
    if (!alreadyApplied) throw new SkillError('stale', `${current.name} changed since you last read it.`, current);
    return current;
  }
  if (next !== current.content) writeAtomic(path.join(dir, SKILL_FILE), next);

  for (const file of planned) {
    if (file.content === null) {
      fs.rmSync(file.full, { force: true });
      pruneEmptyDirs(path.dirname(file.full), dir);
    } else {
      writeAtomic(file.full, file.content);
    }
  }
  return requireSkillAt(dir);
}

function fileHolds(full: string, content: string | null): boolean {
  try {
    return content !== null && fs.readFileSync(full, 'utf8') === content;
  } catch {
    return content === null;
  }
}

function pruneEmptyDirs(from: string, stopAt: string): void {
  let current = from;
  while (current.startsWith(stopAt + path.sep)) {
    try {
      if (fs.readdirSync(current).length > 0) return;
      fs.rmdirSync(current);
    } catch {
      return;
    }
    current = path.dirname(current);
  }
}

/** Set `name:` to the folder's name, when the frontmatter can be read and it differs. */
export function syncNameToFolder(dir: string): void {
  const skill = requireSkillAt(dir);
  if (skill.parsed.frontmatterError === null && skill.parsed.name !== skill.name) {
    writeAtomic(path.join(dir, SKILL_FILE), renderSkillFile(skill.content, { name: skill.name }));
  }
}

/**
 * Move a skill folder to `to` (a rename, or a move to another place),
 * crossing volumes by copying. Sets `name:` to the new folder name. Refuses
 * a bad name or an occupied target.
 */
export function moveSkillFolder(from: string, to: string): SkillDocument {
  requireSkillAt(from);
  const problem = nameProblem(path.basename(to));
  if (problem) throw new SkillError('invalid', problem);
  if (fs.existsSync(to)) throw new SkillError('conflict', `A skill named ${path.basename(to)} is already there.`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  try {
    fs.renameSync(from, to);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.cpSync(from, to, { recursive: true, verbatimSymlinks: true, errorOnExist: true, force: false });
    fs.rmSync(from, { recursive: true, force: true });
  }
  syncNameToFolder(to);
  return requireSkillAt(to);
}

/** Copy a skill folder to `to`, leaving the original. Same checks as a move. */
export function copySkillFolder(from: string, to: string): SkillDocument {
  requireSkillAt(from);
  const problem = nameProblem(path.basename(to));
  if (problem) throw new SkillError('invalid', problem);
  if (fs.existsSync(to)) throw new SkillError('conflict', `A skill named ${path.basename(to)} is already there.`);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true, errorOnExist: true, force: false });
  syncNameToFolder(to);
  return requireSkillAt(to);
}

/** `.archive/<bucket>/<label>-<stamp>`, never overwriting an earlier archive. */
function archiveTarget(root: string, label: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  let target = path.join(root, `${label}-${stamp}`);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(root, `${label}-${stamp}-${n}`);
  return target;
}

/** Move a folder into `<app-root>/.archive/<bucket>/`, where the home backup keeps it. */
export function archiveFolder(source: string, bucket: string, label: string): string {
  const root = path.join(getAppRoot(), '.archive', bucket);
  fs.mkdirSync(root, { recursive: true });
  const target = archiveTarget(root, label);
  try {
    fs.renameSync(source, target);
  } catch (err) {
    // Another volume (an overridden root, a project elsewhere): copy, then remove.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
  return target;
}
