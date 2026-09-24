/**
 * `.ri.local.json`: a source folder's setup on this computer
 * (docs/homes-spec.md §4.1, §4.2).
 *
 * The folder that holds the file is the source folder, so its own path is
 * never written in it. The file says which home the folder belongs to, which
 * agents use it, and where each agent's references live on this computer:
 *
 *   {
 *     "version": 1,
 *     "homeId": "<home-id>",
 *     "agents": {
 *       "<agent-id>": { "references": { "agentex": "../agentex" } }
 *     }
 *   }
 *
 * A reference is a path (relative to this folder, or absolute), another
 * agent's source folder on this computer (`{ "agentId": "..." }`), or `null`
 * to leave it out here on purpose.
 *
 * This file is the one editable authority for machine paths. The home keeps
 * what it last observed, and never edits it. Writes are atomic, and every
 * edit carries the revision it was made against, so an edit from the UI can
 * never overwrite a newer hand edit. Creating a file never replaces one.
 * The file is kept out of Git, through `.git/info/exclude` when the
 * repository doesn't already ignore it.
 */

import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { z } from 'zod';

export const SETUP_FILE = '.ri.local.json';
export const SETUP_FILE_VERSION = 1;

const referenceValue = z.union([
  z.string().min(1),
  z.object({ agentId: z.string().min(1) }).strict(),
  z.null(),
]);

const agentEntry = z
  .object({
    references: z.record(z.string().min(1), referenceValue).default({}),
  })
  .strict();

export const setupFileSchema = z
  .object({
    version: z.literal(SETUP_FILE_VERSION),
    homeId: z.string().min(1),
    agents: z.record(z.string().min(1), agentEntry),
  })
  .strict();

export type SetupFile = z.infer<typeof setupFileSchema>;
export type ReferenceValue = z.infer<typeof referenceValue>;

export type SetupFileRead =
  | { state: 'missing'; dir: string }
  | { state: 'invalid'; dir: string; revision: string; problem: string }
  | { state: 'ok'; dir: string; revision: string; file: SetupFile };

export class SetupFileConflictError extends Error {
  constructor(readonly dir: string) {
    super(`${path.join(dir, SETUP_FILE)} changed since it was read. Reload it and apply the change again.`);
    this.name = 'SetupFileConflictError';
  }
}

export function setupFilePath(dir: string): string {
  return path.join(dir, SETUP_FILE);
}

/** The revision of a setup file is the sha256 of its exact bytes. */
export function revisionOf(content: string | Buffer): string {
  return crypto.createHash('sha256').update(content).digest('hex');
}

export function readSetupFile(dir: string): SetupFileRead {
  const file = setupFilePath(dir);
  let raw: string;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { state: 'missing', dir };
    throw err;
  }
  const revision = revisionOf(raw);
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    return { state: 'invalid', dir, revision, problem: `${SETUP_FILE} is not valid JSON: ${(err as Error).message}` };
  }
  const parsed = setupFileSchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` at ${first.path.join('.')}` : '';
    return { state: 'invalid', dir, revision, problem: `${SETUP_FILE} is malformed${where}: ${first?.message}` };
  }
  return { state: 'ok', dir, revision, file: parsed.data };
}

export function renderSetupFile(file: SetupFile): string {
  return JSON.stringify(setupFileSchema.parse(file), null, 2) + '\n';
}

/**
 * Write the setup file atomically.
 *
 * `expectedRevision` is the revision the change was made against: `null`
 * creates a file and refuses when one exists, a string replaces exactly
 * that revision and refuses anything else.
 */
export function writeSetupFile(dir: string, file: SetupFile, expectedRevision: string | null): string {
  if (!fs.statSync(dir).isDirectory()) throw new Error(`${dir} is not a folder.`);
  const target = setupFilePath(dir);
  const current = readSetupFile(dir);
  if (expectedRevision === null ? current.state !== 'missing' : current.state === 'missing' || current.revision !== expectedRevision) {
    throw new SetupFileConflictError(dir);
  }
  const content = renderSetupFile(file);
  const tmp = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, { mode: 0o600 });
  try {
    if (expectedRevision === null) {
      // Create-only: link fails when the file appeared since the check.
      try {
        fs.linkSync(tmp, target);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === 'EEXIST') throw new SetupFileConflictError(dir);
        throw err;
      }
    } else {
      // Close the window between the check above and the rename.
      const latest = readSetupFile(dir);
      if (latest.state === 'missing' || latest.revision !== expectedRevision) throw new SetupFileConflictError(dir);
      fs.renameSync(tmp, target);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  ensureGitIgnored(dir);
  return revisionOf(content);
}

function git(dir: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return { ok: true, out: out.trim() };
  } catch {
    return { ok: false, out: '' };
  }
}

/**
 * Keep the setup file out of Git: a no-op when the repository already
 * ignores it, otherwise a line in `.git/info/exclude`, which is local to this
 * clone and never committed. Returns what it found or did. A folder that
 * isn't in a Git repository is left alone.
 */
export function ensureGitIgnored(dir: string): 'not_git' | 'already_ignored' | 'excluded' {
  if (!git(dir, ['rev-parse', '--is-inside-work-tree']).ok) return 'not_git';
  if (git(dir, ['check-ignore', '-q', SETUP_FILE]).ok) return 'already_ignored';
  const rel = git(dir, ['rev-parse', '--git-path', 'info/exclude']).out;
  if (!rel) return 'not_git';
  const exclude = path.resolve(dir, rel);
  fs.mkdirSync(path.dirname(exclude), { recursive: true });
  const existing = fs.existsSync(exclude) ? fs.readFileSync(exclude, 'utf8') : '';
  // Git reports the top level by its real path (/private/var on macOS), so
  // compare against this folder's real path too.
  const top = git(dir, ['rev-parse', '--show-toplevel']).out;
  const line = `/${path.relative(top, path.join(fs.realpathSync(dir), SETUP_FILE)).split(path.sep).join('/')}`;
  if (!existing.split('\n').includes(line)) {
    const prefix = existing && !existing.endsWith('\n') ? '\n' : '';
    fs.appendFileSync(exclude, `${prefix}# Ri: this computer's setup for this folder\n${line}\n`);
  }
  return 'excluded';
}
