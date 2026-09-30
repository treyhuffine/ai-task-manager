/**
 * The home's skill library: `<app-root>/skills/<name>/SKILL.md`.
 *
 * This folder is the one copy of every skill Ri manages. Chats Ri starts get
 * these skills attached (src/lib/executor/skills.ts), "outside Ri" is a
 * symlink to the same folder (./outside.ts), and it travels with the home
 * (it's portable content in src/lib/config/paths.ts). So everything here is
 * plain file work on that one folder, with three guards:
 *
 *   - Names are checked before they touch a path, so a name can never climb
 *     out of the library.
 *   - SKILL.md is written atomically (temp file, then rename), so a harness
 *     reading the skill mid-save sees the old file or the new one.
 *   - Writes can carry the hash of the file they were based on. A stale hash
 *     is refused with the current file, which is how the editor and the
 *     builder AI edit the same skill without overwriting each other.
 *
 * Reach (which agents get a skill) lives in the database and in the outside
 * links, not here. See ./reach.ts and docs/skills.md.
 */

import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { getAppRoot } from '@/lib/config/paths';
import {
  SKILL_FILE,
  checkSkill,
  isValidSkillName,
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

/** `<app-root>/skills`. */
export function librarySkillsDir(): string {
  return path.join(getAppRoot(), 'skills');
}

/**
 * A folder name safe to join onto the library path. Looser than the Agent
 * Skills name rules on purpose: a hand-made folder with a capital letter is
 * still readable (and the builder says what to fix), it just can't escape.
 */
function isSafeFolderName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= 255 &&
    !name.startsWith('.') &&
    !name.includes('/') &&
    !name.includes('\\') &&
    !name.includes('\0')
  );
}

function assertSafeFolderName(name: string): void {
  if (!isSafeFolderName(name)) throw new SkillError('invalid', `"${name}" isn't a skill name Ri can use.`);
}

export function skillDir(name: string): string {
  assertSafeFolderName(name);
  return path.join(librarySkillsDir(), name);
}

function skillFile(name: string): string {
  return path.join(skillDir(name), SKILL_FILE);
}

export function hashContent(content: string): string {
  return createHash('sha256').update(content).digest('hex').slice(0, 16);
}

export interface SkillFileEntry {
  /** Relative to the skill folder, with forward slashes. */
  path: string;
  size: number;
}

export interface LibrarySkill {
  /** The folder name: the skill's identity, `name:` and slash command. */
  name: string;
  /** Absolute path to the folder. */
  dir: string;
  description: string | null;
  /** When SKILL.md last changed, ISO. */
  updatedAt: string;
  problems: SkillProblem[];
}

export interface SkillDocument extends LibrarySkill {
  /** The whole SKILL.md. */
  content: string;
  /** Hash of `content`, to send back with the next write. */
  hash: string;
  parsed: ParsedSkillFile;
  /** Everything else in the folder (references/, scripts/, assets/, ...). */
  files: SkillFileEntry[];
}

function summarize(name: string, content: string, mtime: Date): LibrarySkill {
  const parsed = parseSkillFile(content);
  return {
    name,
    dir: skillDir(name),
    description: parsed.description,
    updatedAt: mtime.toISOString(),
    problems: checkSkill(parsed, name),
  };
}

/** Every skill in the library, by name. A folder without SKILL.md isn't a skill. */
export function listLibrarySkills(): LibrarySkill[] {
  const root = librarySkillsDir();
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LibrarySkill[] = [];
  for (const entry of entries) {
    if (!isSafeFolderName(entry.name)) continue;
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const file = path.join(root, entry.name, SKILL_FILE);
    try {
      const content = fs.readFileSync(file, 'utf8');
      out.push(summarize(entry.name, content, fs.statSync(file).mtime));
    } catch {
      // No SKILL.md (or unreadable): not a skill.
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export function librarySkillNames(): Set<string> {
  return new Set(listLibrarySkills().map((skill) => skill.name));
}

export function skillExists(name: string): boolean {
  return isSafeFolderName(name) && fs.existsSync(skillFile(name));
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

export function readSkill(name: string): SkillDocument | null {
  if (!isSafeFolderName(name)) return null;
  const file = skillFile(name);
  let content: string;
  let mtime: Date;
  try {
    content = fs.readFileSync(file, 'utf8');
    mtime = fs.statSync(file).mtime;
  } catch {
    return null;
  }
  return {
    ...summarize(name, content, mtime),
    content,
    hash: hashContent(content),
    parsed: parseSkillFile(content),
    files: listSupportingFiles(skillDir(name)),
  };
}

export function requireSkill(name: string): SkillDocument {
  assertSafeFolderName(name);
  const skill = readSkill(name);
  if (!skill) throw new SkillError('not_found', `There's no skill named ${name}.`);
  return skill;
}

function writeAtomic(file: string, content: string): void {
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
  name: string;
  description?: string;
  body?: string;
}

/** Create a skill folder. Refuses a bad or taken name. */
export function createSkill(input: CreateSkillInput): SkillDocument {
  const problem = nameProblem(input.name);
  if (problem) throw new SkillError('invalid', problem);
  const dir = skillDir(input.name);
  if (fs.existsSync(dir)) throw new SkillError('conflict', `A skill named ${input.name} already exists.`);
  fs.mkdirSync(dir, { recursive: true });
  writeAtomic(
    path.join(dir, SKILL_FILE),
    renderSkillFile(null, { name: input.name, description: input.description ?? '', body: input.body ?? '' }),
  );
  return requireSkill(input.name);
}

export interface SupportingFileWrite {
  /** Relative path inside the skill folder, like references/api.md. */
  path: string;
  /** New text, or null to delete the file. */
  content: string | null;
}

export interface WriteSkillInput {
  /** Replace SKILL.md whole (the editor's File mode). Wins over `fields`. */
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
export function writeSkill(name: string, input: WriteSkillInput): SkillDocument {
  const current = requireSkill(name);
  const dir = skillDir(name);
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
    if (!alreadyApplied) throw new SkillError('stale', `${name} changed since you last read it.`, current);
    return current;
  }
  if (next !== current.content) writeAtomic(skillFile(name), next);

  for (const file of planned) {
    if (file.content === null) {
      fs.rmSync(file.full, { force: true });
      pruneEmptyDirs(path.dirname(file.full), dir);
    } else {
      writeAtomic(file.full, file.content);
    }
  }
  return requireSkill(name);
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

/**
 * Move a skill's folder to a new name and set `name:` to match. Only the
 * folder: the caller carries its reach, links and chats (see ./manage.ts).
 */
export function renameSkillFolder(from: string, to: string): SkillDocument {
  const current = requireSkill(from);
  if (from === to) return current;
  const problem = nameProblem(to);
  if (problem) throw new SkillError('invalid', problem);
  const target = skillDir(to);
  if (fs.existsSync(target)) throw new SkillError('conflict', `A skill named ${to} already exists.`);
  fs.renameSync(skillDir(from), target);
  const renamed = requireSkill(to);
  if (renamed.parsed.name !== to && renamed.parsed.frontmatterError === null) {
    writeAtomic(skillFile(to), renderSkillFile(renamed.content, { name: to }));
  }
  return requireSkill(to);
}

/** `.archive/skills/<name>-<stamp>`, never overwriting an earlier archive. */
function archiveTarget(root: string, name: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
  let target = path.join(root, `${name}-${stamp}`);
  for (let n = 2; fs.existsSync(target); n++) target = path.join(root, `${name}-${stamp}-${n}`);
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
    // Another volume (an overridden root): copy, then remove.
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.cpSync(source, target, { recursive: true, verbatimSymlinks: true });
    fs.rmSync(source, { recursive: true, force: true });
  }
  return target;
}

/** Move a skill out of the library into the archive. Returns where it went. */
export function archiveSkillFolder(name: string): string {
  requireSkill(name);
  return archiveFolder(skillDir(name), 'skills', name);
}

export { isValidSkillName };
