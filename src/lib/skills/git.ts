/**
 * Git for project skills. A project skill is shared by being committed to
 * the repo, so the builder shows when one has changes that aren't committed
 * yet and can commit exactly that skill's files, nothing else, on whatever
 * branch the folder has checked out. It never pushes: the remote is the
 * user's business.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { SkillError } from './library';

const execFileAsync = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 30_000,
    maxBuffer: 4 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  });
  return stdout;
}

export async function isGitRepo(cwd: string): Promise<boolean> {
  try {
    return (await git(cwd, ['rev-parse', '--is-inside-work-tree'])).trim() === 'true';
  } catch {
    return false;
  }
}

export async function currentBranch(cwd: string): Promise<string | null> {
  try {
    const branch = (await git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}

const SKILL_ROOTS = ['.claude/skills', '.agents/skills', '.ri/skills'];

/**
 * Names of the project's skills with changes git hasn't committed (new,
 * edited, or deleted), from one `git status` over the skill folders.
 */
export async function uncommittedSkillNames(cwd: string): Promise<Set<string>> {
  const names = new Set<string>();
  let out: string;
  try {
    out = await git(cwd, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--', ...SKILL_ROOTS]);
  } catch {
    return names;
  }
  for (const record of out.split('\0')) {
    // "XY path", except a rename's original path, which arrives as its own record without the status.
    const file = /^[ MTADRCU?!]{2} /.test(record) ? record.slice(3) : record;
    for (const root of SKILL_ROOTS) {
      if (file.startsWith(`${root}/`)) {
        const name = file.slice(root.length + 1).split('/')[0];
        if (name) names.add(name);
      }
    }
  }
  return names;
}

export interface SkillCommit {
  sha: string;
  branch: string | null;
  message: string;
}

/**
 * Commit one skill's paths (its folder and its `.agents/skills` link) and
 * nothing else, even when other changes are staged. Hooks run as for any
 * commit, and a failing hook's message comes back as the error.
 */
export async function commitSkillPaths(cwd: string, name: string, paths: string[]): Promise<SkillCommit> {
  if (!(await isGitRepo(cwd))) throw new SkillError('invalid', "This agent's folder isn't a git repository.");
  // Only paths git can act on: ones on disk, or tracked ones that were deleted.
  const tracked = new Set(
    (await git(cwd, ['ls-files', '-z', '--', ...paths]).catch(() => '')).split('\0').filter(Boolean),
  );
  const present = paths.filter((p) => {
    try {
      fs.lstatSync(path.join(cwd, p));
      return true;
    } catch {
      return [...tracked].some((file) => file === p || file.startsWith(`${p}/`));
    }
  });
  if (present.length === 0) throw new SkillError('invalid', `There's nothing of ${name} to commit.`);

  const existed = tracked.size > 0;
  const message = existed ? `Update the ${name} skill` : `Add the ${name} skill`;
  try {
    await git(cwd, ['add', '-A', '--', ...present]);
    const staged = await git(cwd, ['diff', '--cached', '--name-only', '--', ...present]);
    if (!staged.trim()) throw new SkillError('invalid', `${name} has no changes to commit.`);
    await git(cwd, ['commit', '--quiet', '-m', message, '--', ...present]);
  } catch (err) {
    if (err instanceof SkillError) throw err;
    const detail = (err as { stderr?: string }).stderr?.trim() || (err as Error).message;
    throw new SkillError('invalid', `Git couldn't commit it: ${detail.split('\n').slice(-3).join(' ')}`);
  }
  const sha = (await git(cwd, ['rev-parse', '--short', 'HEAD'])).trim();
  return { sha, branch: await currentBranch(cwd), message };
}
