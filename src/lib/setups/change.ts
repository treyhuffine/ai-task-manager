/**
 * One change to this computer's setups, undone as a whole when any part of
 * it fails (docs/homes-spec.md §4.2).
 *
 * Moving an agent touches two setup files and the registry. Each step here
 * records what it replaced the first time it touches a file or a folder's
 * registration, so `undo` can put every one back exactly: the same bytes,
 * and the same registration. Undo runs in reverse, so the folder the agent
 * came from is restored before the one it was going to is cleared: a crash
 * partway through leaves the agent set up twice, which the resolver reports,
 * never nowhere.
 *
 * Undo is revision-checked like every other write. A file someone changed
 * after this change wrote it is left alone and named in the result.
 */

import path from 'node:path';
import {
  readSetupBytes,
  removeSetupFile,
  revisionOf,
  SETUP_FILE,
  writeSetupBytes,
  writeSetupFile,
  type SetupFile,
} from './local-file';
import {
  getLocation,
  moveLocation,
  registerLocation,
  restoreLocation,
  unregisterLocation,
  type RegisteredLocation,
} from './registry';

type Touched =
  | { kind: 'file'; dir: string; before: string | null; now: string | null }
  | { kind: 'registration'; dir: string; before: RegisteredLocation | null };

export class SetupChange {
  private touched: Touched[] = [];

  get changed(): boolean {
    return this.touched.length > 0;
  }

  /** Write a folder's setup file against the revision it was read at. */
  write(dir: string, file: SetupFile, expectedRevision: string | null): string {
    const entry = this.file(dir);
    const revision = writeSetupFile(dir, file, expectedRevision);
    entry.now = revision;
    return revision;
  }

  /** Remove a folder's setup file, if it's still at the revision it was read at. */
  remove(dir: string, expectedRevision: string): void {
    const entry = this.file(dir);
    removeSetupFile(dir, expectedRevision);
    entry.now = null;
  }

  register(dir: string): void {
    this.registration(dir);
    registerLocation(dir);
  }

  unregister(dir: string): void {
    this.registration(dir);
    unregisterLocation(dir);
  }

  moveRegistration(from: string, to: string): void {
    this.registration(from);
    this.registration(to);
    moveLocation(from, to);
  }

  /**
   * Put back everything this change touched, newest first. Returns what
   * couldn't be put back, empty when everything was.
   */
  undo(): string[] {
    const problems: string[] = [];
    for (const t of [...this.touched].reverse()) {
      try {
        if (t.kind === 'registration') restoreLocation(t.dir, t.before);
        else {
          const problem = undoFile(t);
          if (problem) problems.push(problem);
        }
      } catch (err) {
        const what = t.kind === 'file' ? path.join(t.dir, SETUP_FILE) : `the registration of ${t.dir}`;
        problems.push(`${what}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    this.touched = [];
    return problems;
  }

  private file(dir: string): Extract<Touched, { kind: 'file' }> {
    const d = path.resolve(dir);
    const seen = this.touched.find((t): t is Extract<Touched, { kind: 'file' }> => t.kind === 'file' && t.dir === d);
    if (seen) return seen;
    const before = readSetupBytes(d);
    const entry = { kind: 'file' as const, dir: d, before, now: before === null ? null : revisionOf(before) };
    this.touched.push(entry);
    return entry;
  }

  private registration(dir: string): void {
    const d = path.resolve(dir);
    if (this.touched.some((t) => t.kind === 'registration' && t.dir === d)) return;
    this.touched.push({ kind: 'registration', dir: d, before: getLocation(d) });
  }
}

/** Put one file back, unless someone changed it since this change left it. */
function undoFile(t: Extract<Touched, { kind: 'file' }>): string | null {
  const bytes = readSetupBytes(t.dir);
  const current = bytes === null ? null : revisionOf(bytes);
  if (current !== t.now) return `${path.join(t.dir, SETUP_FILE)} changed since, so it was left as it is`;
  if (t.before === null) {
    if (t.now !== null) removeSetupFile(t.dir, t.now);
  } else if (t.now === null || revisionOf(t.before) !== t.now) {
    writeSetupBytes(t.dir, t.before, t.now);
  }
  return null;
}
