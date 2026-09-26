/**
 * An execution's resolved environment (docs/homes-spec.md §4.3,
 * docs/homes-build.md P2.7): where it works, from which folder, on which
 * branch, with which connected folders and tools. The home says what's
 * expected. The computer running the session resolves what only it knows,
 * from its own setup files and Git, when the session starts: the agent's
 * folder, each reference, the mode, and the checked-out commit. So a session
 * never starts from the home's cached copy of another computer's paths.
 *
 * Delivered twice: a JSON file beside the session instructions, outside
 * every repository, and a short block at the end of the instructions that
 * names it. No database here: the home's runner and a worker both run it.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { listRegisteredLocations } from '@/lib/setups/registry';
import { resolveSetups, type ReferenceReport } from '@/lib/setups/resolve';

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
  computerName: string;
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

/**
 * An agent's folder and references as the home expects them on a computer:
 * what the running side resolves against its own setup files.
 */
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

function stateOf(report: ReferenceReport): ReferenceState {
  if (report.form === 'omitted') return 'omitted';
  if (report.form === 'unconfigured') return 'unconfigured';
  return report.exists ? 'ready' : 'missing';
}

/**
 * The agent's folder and references as this computer's setup files have
 * them, when exactly one valid setup here is for the agent.
 *
 * `whenUnresolved` says what stands when there isn't one (none, or two
 * folders claiming the agent). `'expected'` keeps the home's values: a home
 * agent from before setups, at home. `'unavailable'` is for a session
 * elsewhere, where the home's values are only a cached report of this
 * computer and never the authority for what a harness may read: no source
 * folder, and every reference unavailable, with no path (P2.7 to P2.9
 * re-check).
 */
export function resolveAgentFolders(
  expected: ExpectedAgentFolders,
  whenUnresolved: 'expected' | 'unavailable',
): Pick<ExpectedAgentFolders, 'sourceFolder' | 'references'> {
  const env = expected;
  const reports = resolveSetups({
    homeId: env.homeId,
    registered: listRegisteredLocations().map((l) => l.dir),
    expected: { [env.agentId]: env.references.map((r) => ({ alias: r.alias })) },
  }).filter((r) => r.agentId === env.agentId);
  const report = reports.length === 1 && reports[0]!.status !== 'duplicate' ? reports[0]! : null;
  const strict = whenUnresolved === 'unavailable';
  if (!report) {
    if (!strict) return { sourceFolder: env.sourceFolder, references: env.references };
    return { sourceFolder: null, references: env.references.map((ref) => ({ ...ref, path: null, state: 'unavailable' as const })) };
  }
  return {
    sourceFolder: report.sourcePath,
    references: env.references.map((ref) => {
      const here = report.references.find((r) => r.alias === ref.alias);
      if (here) return { ...ref, path: here.path, state: stateOf(here) };
      return strict ? { ...ref, path: null, state: 'unconfigured' as const } : ref;
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
  local: Pick<ExpectedAgentFolders, 'sourceFolder' | 'references'> = resolveAgentFolders(
    { homeId: env.homeId, agentId: env.agent.id, sourceFolder: env.sourceFolder, references: env.references },
    'expected',
  ),
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
  omitted: 'left out on this computer',
  unconfigured: "not set up on this computer",
  missing: "set up, but the folder isn't there",
  unavailable: 'unavailable, because this computer has no single setup for the agent (none, or more than one)',
} as const;

const short = (sha: string | null) => (sha ? sha.slice(0, 12) : null);

/** The block at the end of the session instructions. */
export function renderEnvironment(env: ResolvedEnvironment, file: string): string {
  const lines = [
    '## Your environment',
    '',
    `You're running on ${env.computerName}, for ${env.homeName}, as the "${env.agent.name}" agent. This is how it was when this session started. The same, as JSON: \`${file}\``,
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
