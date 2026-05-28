/**
 * `flow resume [--workspace <id>]`.
 *
 * Closes the loop on a `flow takeover`. Pushes any local commits on the
 * takeover branch, then asks the host to pull + post a synthetic user
 * message into the chat with the diff summary, then clears the local
 * state file.
 *
 * With no args, picks the most recently started takeover on this
 * machine. Use `--workspace <id>` (or workspace name) to disambiguate
 * when multiple takeovers are in flight.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command } from 'commander';
import pc from 'picocolors';
import {
  clearState,
  findActiveTakeovers,
  type ActiveTakeover,
} from '../lib/takeover-state';

const execFileAsync = promisify(execFile);

interface ResumeOptions {
  workspace?: string;
  yes?: boolean;
}

interface ResumeResponse {
  ok: true;
  filesChanged: number;
  shortstat: string;
  sessionId: string;
}

function pick(active: ActiveTakeover[], filter: string | undefined): ActiveTakeover | null {
  if (active.length === 0) return null;
  if (!filter) {
    if (active.length === 1) return active[0];
    return null; // ambiguous — caller will print options
  }
  // Match by workspaceId OR workspaceName (case-insensitive).
  const lower = filter.toLowerCase();
  return (
    active.find(
      (t) =>
        t.state.workspaceId === filter ||
        t.state.workspaceName.toLowerCase() === lower,
    ) ?? null
  );
}

async function isDirty(clonePath: string): Promise<boolean> {
  const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: clonePath });
  return stdout.trim().length > 0;
}

async function autoCommit(clonePath: string): Promise<void> {
  console.log(pc.dim('Committing local changes...'));
  await execFileAsync('git', ['add', '-A'], { cwd: clonePath });
  const message = `Takeover edits ${new Date().toISOString()}`;
  await execFileAsync('git', ['commit', '-m', message], { cwd: clonePath });
}

async function pushBranch(clonePath: string, branch: string): Promise<void> {
  await execFileAsync('git', ['push', 'origin', branch], { cwd: clonePath });
}

async function callResume(host: string, token: string): Promise<ResumeResponse> {
  const url = `${host.replace(/\/+$/, '')}/api/takeover/${token}/resume`;
  const res = await fetch(url, { method: 'POST' });
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        'Server doesn\'t recognise this takeover anymore. It may have been cancelled or already resumed.',
      );
    }
    if (res.status === 409) {
      let body: { message?: string } = {};
      try {
        body = (await res.json()) as { message?: string };
      } catch {
        /* ignore */
      }
      throw new Error(`Pull conflict on the host worktree.${body.message ? `\n${body.message}` : ''}`);
    }
    if (res.status === 410) {
      throw new Error(
        'Takeover token expired. The server cleared it after one hour.',
      );
    }
    let detail = '';
    try {
      detail = JSON.stringify(await res.json());
    } catch {
      /* ignore */
    }
    throw new Error(`Server returned ${res.status} ${res.statusText}. ${detail}`);
  }
  return (await res.json()) as ResumeResponse;
}

export async function resumeCommand(opts: ResumeOptions) {
  const active = findActiveTakeovers();

  if (active.length === 0) {
    console.log(pc.dim('No active takeover on this machine.'));
    console.log(pc.dim('Start one with `flow takeover <url>` from the browser modal.'));
    return;
  }

  const chosen = pick(active, opts.workspace);
  if (!chosen) {
    if (active.length > 1 && !opts.workspace) {
      console.error(pc.red('Multiple active takeovers — disambiguate with --workspace <name-or-id>:'));
      for (const t of active) {
        console.error(
          `  ${pc.cyan(t.state.workspaceName)} ${pc.dim(t.state.workspaceId)} — ${t.state.branch}`,
        );
      }
    } else {
      console.error(pc.red(`No takeover matches "${opts.workspace}".`));
    }
    process.exit(1);
  }

  const { clonePath, state } = chosen;
  console.log(pc.dim(`Resuming ${state.workspaceName} (${state.branch}) at ${clonePath}`));

  // Stage any uncommitted local edits so the push captures them. The
  // happy path here is "user hit save in the editor and forgot to
  // commit"; auto-committing beats failing with a confusing error.
  if (await isDirty(clonePath)) {
    await autoCommit(clonePath);
  }

  try {
    await pushBranch(clonePath, state.branch);
    console.log(pc.green(`✓ Pushed ${state.branch} to origin.`));
  } catch (err) {
    console.error(pc.red('Push failed. Resolve manually, then retry `flow resume`.'));
    if (err instanceof Error) console.error(pc.dim(err.message));
    process.exit(1);
  }

  let response: ResumeResponse;
  try {
    response = await callResume(state.host, state.token);
  } catch (err) {
    console.error(pc.red(err instanceof Error ? err.message : String(err)));
    process.exit(1);
  }

  clearState(clonePath);

  console.log(
    pc.green(
      `✓ Host pulled ${response.filesChanged} file(s)${response.shortstat ? ` (${response.shortstat})` : ''}, posted diff to agent.`,
    ),
  );
  console.log(pc.dim(`Open the session to continue: ${state.host}`));
}

export function registerResumeCommand(program: Command) {
  program
    .command('resume')
    .description('Push your local takeover changes back to the host and resume the agent')
    .option('-w, --workspace <name-or-id>', 'Disambiguate when multiple takeovers are active')
    .action(resumeCommand);
}
