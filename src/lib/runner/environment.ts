/**
 * An execution's resolved environment (docs/homes-spec.md §4.3,
 * docs/homes-build.md P2.7): where it works, from which folder, on which
 * branch, with which connected folders and tools. The home says what's
 * expected: the agent's folders on this device, from its records, the only
 * place they're kept (docs/homes-spec.md §4.1). The device running the
 * session checks what only it can, when the session starts: whether each
 * folder is there, the mode, and the checked-out commit.
 *
 * Delivered twice: a JSON file beside the session instructions, outside
 * every repository, and a short block at the end of the instructions that
 * names it. No database here: the home's runner and a worker both run it.
 */

import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type ReferenceState = 'ready' | 'omitted' | 'unconfigured' | 'missing' | 'unavailable';

export interface EnvironmentReference {
  alias: string;
  description: string | null;
  path: string | null;
  state: ReferenceState;
}

/** What the home says about an execution's environment. Paths are its best knowledge, which the running side replaces. */
export interface ExecutionEnvironment {
  homeId: string;
  homeName: string;
  deviceName: string;
  agent: { id: string; name: string };
  executionId: string;
  isGit: boolean;
  cwd: string;
  sourceFolder: string | null;
  branch: string | null;
  baseBranch: string | null;
  baseSha: string | null;
  references: EnvironmentReference[];
  tools: { connectors: boolean; browser: boolean };
  harness: string;
  model: string | null;
  permissionMode: string;
}

/** An agent's folder and references on a device, as the home records them. */
export interface ExpectedAgentFolders {
  homeId: string;
  agentId: string;
  sourceFolder: string | null;
  references: EnvironmentReference[];
}

/** As the running side resolved it, when the session started. */
export interface ResolvedEnvironment extends ExecutionEnvironment {
  /** A worktree of its own, the agent's folder itself (live), or a folder that isn't a repository. */
  mode: 'worktree' | 'live' | 'folder';
  head: string | null;
  resolvedAt: string;
}

function isDirectory(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/**
 * The agent's folder and linked folders as the home records them on this
 * device, each checked here and now: one that isn't there is `missing`,
 * and never wired. Nothing here reads anything but the folders themselves.
 */
export function resolveAgentFolders(expected: ExpectedAgentFolders): Pick<ExpectedAgentFolders, 'sourceFolder' | 'references'> {
  return {
    sourceFolder: expected.sourceFolder && isDirectory(expected.sourceFolder) ? expected.sourceFolder : null,
    references: expected.references.map((ref) => {
      if (ref.state !== 'ready' || !ref.path) return ref;
      return isDirectory(ref.path) ? ref : { ...ref, state: 'missing' as const };
    }),
  };
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    return (await run('git', args, { cwd })).stdout.trim() || null;
  } catch {
    return null;
  }
}

/**
 * `local` is the agent's folders as already resolved here, when the caller
 * wires something else from the same resolution (the reference folders).
 */
export async function resolveEnvironment(
  env: ExecutionEnvironment,
  now = new Date(),
  local: Pick<ExpectedAgentFolders, 'sourceFolder' | 'references'> = resolveAgentFolders({
    homeId: env.homeId,
    agentId: env.agent.id,
    sourceFolder: env.sourceFolder,
    references: env.references,
  }),
): Promise<ResolvedEnvironment> {
  const mode = !env.isGit ? 'folder' : local.sourceFolder && local.sourceFolder === env.cwd ? 'live' : 'worktree';
  const [branch, head] = env.isGit
    ? await Promise.all([git(env.cwd, ['branch', '--show-current']), git(env.cwd, ['rev-parse', 'HEAD'])])
    : [null, null];
  return { ...env, ...local, mode, branch: branch ?? env.branch, head, resolvedAt: now.toISOString() };
}

const MODE = {
  worktree: 'a worktree of its own, separate from the agent\'s folder',
  live: "the agent's folder itself (live mode: edits land in that checkout)",
  folder: "the agent's folder, which isn't a Git repository",
} as const;

const REFERENCE_STATE = {
  ready: '',
  omitted: 'left out on this device',
  unconfigured: "not set up on this device",
  missing: "set up, but the folder isn't there",
  unavailable: 'unavailable, because this device has no single setup for the agent (none, or more than one)',
} as const;

const short = (sha: string | null) => (sha ? sha.slice(0, 12) : null);

/** The block at the end of the session instructions. */
export function renderEnvironment(env: ResolvedEnvironment, file: string): string {
  const lines = [
    '## Your environment',
    '',
    `You're running on ${env.deviceName}, for ${env.homeName}, as the "${env.agent.name}" agent. This is how it was when this session started. The same, as JSON: \`${file}\``,
    '',
    `- Working folder: \`${env.cwd}\`, ${MODE[env.mode]}.`,
  ];
  if (env.sourceFolder && env.sourceFolder !== env.cwd) lines.push(`- The agent's folder: \`${env.sourceFolder}\`.`);
  if (env.isGit) {
    const on = env.branch ? `branch \`${env.branch}\`` : 'a detached HEAD';
    const base = env.baseBranch ? `, from \`${env.baseBranch}\`${env.baseSha ? ` at ${short(env.baseSha)}` : ''}` : '';
    lines.push(`- Git: ${on}${base}${env.head ? `, HEAD ${short(env.head)}` : ''}.`);
  }
  if (env.references.length > 0) {
    lines.push('- Connected folders:');
    for (const ref of env.references) {
      const where = ref.state === 'ready' && ref.path ? `\`${ref.path}\`` : REFERENCE_STATE[ref.state];
      lines.push(`  - ${ref.alias}: ${where}${ref.description ? `. ${ref.description}` : ''}`);
    }
  }
  const tools = [env.tools.connectors ? 'connectors' : null, env.tools.browser ? 'the agent browser' : null].filter(Boolean);
  lines.push(`- Tools from ${env.homeName}: ${tools.length > 0 ? tools.join(' and ') : 'none'}.`);
  return lines.join('\n');
}
