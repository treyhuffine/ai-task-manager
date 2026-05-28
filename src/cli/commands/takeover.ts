/**
 * `flow takeover <url>` and `flow takeover --list`.
 *
 * Takes the copy-paste URL the browser modal hands the user, fetches
 * clone info from the host, clones (or fetches) the workspace into a
 * canonical local path, checks out the takeover branch, opens the
 * editor, and writes a state file for `flow resume` to find later.
 *
 * The URL shape is `<scheme>://<host>:<port>/t/<token>`. Host and token
 * are derived from it — no flags to set, no `flow connect` to run
 * first. The token expires in 1h on the server side; running the
 * command after that just prints a friendly "ask for a new takeover."
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command } from 'commander';
import pc from 'picocolors';
import { ensureClonesDir } from '@/lib/config/paths';
import { readCliConfig } from '../lib/cli-config';
import {
  cloneDirFor,
  findActiveTakeovers,
  writeState,
} from '../lib/takeover-state';
import { openInEditor } from '../lib/open-editor';

const execFileAsync = promisify(execFile);

interface ParsedUrl {
  host: string;
  token: string;
}

function parseTakeoverUrl(raw: string): ParsedUrl {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Not a valid URL: ${raw}`);
  }
  // Accept both `/t/<token>` and `/api/takeover/<token>` shapes so users
  // who paste the API URL directly also work.
  const tMatch = url.pathname.match(/^\/t\/([^/]+)\/?$/);
  const apiMatch = url.pathname.match(/^\/api\/takeover\/([^/]+)\/?$/);
  const token = tMatch?.[1] ?? apiMatch?.[1];
  if (!token) {
    throw new Error(
      `URL doesn't look like a takeover link. Expected ${url.origin}/t/<token>, got ${raw}`,
    );
  }
  return { host: url.origin, token };
}

interface TakeoverInfoResponse {
  sessionId: string;
  workspaceId: string;
  workspaceName: string;
  remoteUrl: string;
  branch: string;
  baseSha: string;
  hostLabel: string;
}

async function fetchInfo(host: string, token: string): Promise<TakeoverInfoResponse> {
  const url = `${host.replace(/\/+$/, '')}/api/takeover/${token}`;
  const res = await fetch(url);
  if (!res.ok) {
    if (res.status === 404) {
      throw new Error(
        'Token not found. The takeover may have been cancelled, or this is a stale URL — ask the browser to start a new takeover.',
      );
    }
    if (res.status === 410) {
      throw new Error(
        'Token expired. Ask the browser to start a new takeover.',
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
  return (await res.json()) as TakeoverInfoResponse;
}

async function ensureClone(clonePath: string, remoteUrl: string): Promise<void> {
  const gitDir = path.join(clonePath, '.git');
  if (fs.existsSync(clonePath) && !fs.existsSync(gitDir)) {
    throw new Error(
      `Clone path exists but isn't a git repo: ${clonePath}\nMove or remove it, then retry.`,
    );
  }
  if (!fs.existsSync(clonePath)) {
    ensureClonesDir();
    console.log(pc.dim(`Cloning ${remoteUrl} → ${clonePath}`));
    await execFileAsync('git', ['clone', remoteUrl, clonePath], { maxBuffer: 32 * 1024 * 1024 });
    return;
  }
  console.log(pc.dim(`Reusing existing clone at ${clonePath}; fetching origin…`));
  await execFileAsync('git', ['fetch', 'origin'], { cwd: clonePath, maxBuffer: 32 * 1024 * 1024 });
}

async function checkout(clonePath: string, branch: string): Promise<void> {
  // Try a plain checkout first (works when the local branch already
  // exists from a prior takeover). Fall back to creating it tracking
  // the remote — git complains with "fatal: pathspec did not match" if
  // the branch is new on this clone.
  try {
    await execFileAsync('git', ['checkout', branch], { cwd: clonePath });
  } catch {
    await execFileAsync(
      'git',
      ['checkout', '-b', branch, `origin/${branch}`],
      { cwd: clonePath },
    );
  }
}

interface TakeoverOptions {
  noOpen?: boolean;
  list?: boolean;
}

export async function takeoverCommand(urlArg: string | undefined, opts: TakeoverOptions) {
  if (opts.list) {
    const active = findActiveTakeovers();
    if (active.length === 0) {
      console.log(pc.dim('No active takeovers on this machine.'));
      return;
    }
    console.log(pc.bold('Active takeovers:'));
    for (const t of active) {
      console.log(
        `  ${pc.cyan(t.state.workspaceName)} ` +
          pc.dim(`(${t.state.branch})  started ${t.state.startedAt}\n    ${t.clonePath}`),
      );
    }
    return;
  }

  if (!urlArg) {
    console.error(
      pc.red('Missing URL argument. Run `flow takeover <url>` with the link from the browser modal.'),
    );
    process.exit(1);
  }

  const { host, token } = parseTakeoverUrl(urlArg);
  console.log(pc.dim(`Contacting ${host}…`));
  const info = await fetchInfo(host, token);

  const clonePath = cloneDirFor(info.workspaceId);
  await ensureClone(clonePath, info.remoteUrl);
  await checkout(clonePath, info.branch);

  writeState(clonePath, {
    host,
    token,
    sessionId: info.sessionId,
    workspaceId: info.workspaceId,
    workspaceName: info.workspaceName,
    branch: info.branch,
    startedAt: new Date().toISOString(),
  });

  console.log(pc.green(`✓ Branch ${info.branch} checked out at ${clonePath}.`));

  if (!opts.noOpen) {
    const cfg = readCliConfig();
    const result = await openInEditor(clonePath, cfg.editor);
    if (result.ok) {
      console.log(pc.green(`✓ Opened in ${cfg.editor}.`));
    } else {
      console.log(
        pc.yellow(`Could not launch editor automatically. Open manually: ${result.url}`),
      );
    }
  }

  console.log('');
  console.log(`When you're done, run ${pc.bold('flow resume')} to sync your changes back to the host.`);
}

export function registerTakeoverCommand(program: Command) {
  program
    .command('takeover [url]')
    .description('Take over an agent session locally — clones the workspace and opens it in your editor')
    .option('--no-open', "Don't auto-launch the editor after cloning")
    .option('--list', 'List active takeovers on this machine instead of starting a new one')
    .action(takeoverCommand);
}
