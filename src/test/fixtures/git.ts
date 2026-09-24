/**
 * Git fixtures: bare remotes and clones at different paths on different
 * "computers", for setup, review, continuation and ownership tests.
 *
 * `createGitFixture()` makes an isolated base with named bare remotes. Clone
 * one anywhere, commit, push and fetch through plain git. Every repository
 * gets a local identity, so tests don't depend on the machine's git config.
 *
 * `createTwoComputerLayout()` builds the two layouts from docs/homes-spec.md
 * §4.1: the same app and agentex repositories cloned to different folders
 * on a MacBook and a Mac Mini.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createTestComputer, type TestComputer } from './home';

const GIT_ENV = {
  ...process.env,
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Ri Test',
  GIT_AUTHOR_EMAIL: 'test@ri.local',
  GIT_COMMITTER_NAME: 'Ri Test',
  GIT_COMMITTER_EMAIL: 'test@ri.local',
};

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

export interface GitFixture {
  base: string;
  /** Create a bare remote with one commit on `main`. Returns its path. */
  remote(name: string, files?: Record<string, string>): string;
  /** Clone a remote to an absolute path. Returns the path. */
  clone(remotePath: string, dest: string): string;
  /** Write files, commit them, and return the new commit sha. */
  commit(repo: string, files: Record<string, string>, message?: string): string;
  cleanup(): void;
}

export function createGitFixture(): GitFixture {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'ri-test-git-'));
  let counter = 0;

  const commit = (repo: string, files: Record<string, string>, message?: string) => {
    for (const [rel, content] of Object.entries(files)) {
      const p = path.join(repo, rel);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content);
    }
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', message ?? `commit ${++counter}`);
    return git(repo, 'rev-parse', 'HEAD');
  };

  return {
    base,
    remote(name, files = { 'README.md': `# ${name}\n` }) {
      const bare = path.join(base, 'remotes', `${name}.git`);
      fs.mkdirSync(bare, { recursive: true });
      git(bare, 'init', '-q', '--bare', '-b', 'main');
      const seed = path.join(base, 'seed', name);
      fs.mkdirSync(seed, { recursive: true });
      git(seed, 'init', '-q', '-b', 'main');
      commit(seed, files, 'initial');
      git(seed, 'remote', 'add', 'origin', bare);
      git(seed, 'push', '-q', 'origin', 'main');
      fs.rmSync(seed, { recursive: true, force: true });
      return bare;
    },
    clone(remotePath, dest) {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      execFileSync('git', ['clone', '-q', remotePath, dest], { env: GIT_ENV, stdio: 'ignore' });
      return dest;
    },
    commit,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

export interface ComputerLayout {
  computer: TestComputer;
  /** The app's source folder on this computer. */
  app: string;
  /** The agentex checkout on this computer. */
  agentex: string;
  /** How the app's folder reaches agentex, relative to the app folder. */
  agentexRelative: string;
}

export interface TwoComputerLayout {
  git: GitFixture;
  appRemote: string;
  agentexRemote: string;
  macbook: ComputerLayout;
  mini: ComputerLayout;
  cleanup(): void;
}

/**
 * The spec's example: one Ri agent whose folders differ by computer.
 *
 * | Computer | App folder       | Agentex             |
 * | MacBook  | ~/dynamism/ri    | ~/dynamism/agentex  |
 * | Mac Mini | ~/ai-task-manager | ~/code/agentex     |
 *
 * `monorepoSubdir` puts the agent in a subfolder of the app repository, so
 * tests can check that a worktree keeps the repository's layout.
 */
export function createTwoComputerLayout(opts: { monorepoSubdir?: string } = {}): TwoComputerLayout {
  const g = createGitFixture();
  const appFiles: Record<string, string> = { 'package.json': '{"name":"app"}\n' };
  if (opts.monorepoSubdir) appFiles[path.join(opts.monorepoSubdir, 'package.json')] = '{"name":"sub"}\n';
  const appRemote = g.remote('app', appFiles);
  const agentexRemote = g.remote('agentex', { 'package.json': '{"name":"agentex"}\n' });

  const place = (name: string, appRel: string, agentexRel: string): ComputerLayout => {
    const computer = createTestComputer(name);
    const appRepo = g.clone(appRemote, path.join(computer.userDir, appRel));
    const agentex = g.clone(agentexRemote, path.join(computer.userDir, agentexRel));
    const app = opts.monorepoSubdir ? path.join(appRepo, opts.monorepoSubdir) : appRepo;
    return { computer, app, agentex, agentexRelative: path.relative(app, agentex) };
  };

  const macbook = place('macbook', 'dynamism/ri', 'dynamism/agentex');
  const mini = place('mini', 'ai-task-manager', 'code/agentex');
  return {
    git: g,
    appRemote,
    agentexRemote,
    macbook,
    mini,
    cleanup() {
      macbook.computer.cleanup();
      mini.computer.cleanup();
      g.cleanup();
    },
  };
}
