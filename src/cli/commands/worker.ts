/**
 * `<app> worker`: run agents on this computer for your home
 * (docs/homes-build.md, P2.2).
 *
 *   ri worker enroll [--code <code>] [--yes]   let your home run agents here
 *   ri worker run                              connect and stay connected
 *   ri worker status                           this computer's enrollment
 *   ri worker open                             open your Ri in this computer's browser, as This Mac
 *   ri worker disable                          stop running agents here
 *   ri worker grant [--computer <name>] [--name <new>]   on the home: a code for another computer to enroll with
 *
 * Enrolling asks first, on this computer: that's the local approval. The
 * home issues this computer a worker key of its own, separate from the key
 * it's connected with, which never gains that authority.
 */

import os from 'node:os';
import readline from 'node:readline/promises';
import pc from 'picocolors';
import type { Command } from 'commander';
import { APP_SHORT_ID } from '@/constants/app';
import { readConnection, type ConnectionConfig } from '@/lib/connection/config';
import { homeFetch, HomeRequestError } from '@/lib/connection/home-client';
import { WORKER_PROTOCOL } from '@/lib/workers/protocol';
import { readWorkerConfig, removeWorkerConfig, writeWorkerConfig, type WorkerConfig } from '@/lib/worker/config';
import { workerFetch, WorkerNetworkError, WorkerStoppedError, type WorkerTarget } from '@/lib/worker/client';
import { openBrowser } from '../lib/browser';

function workerVersion(): string {
  return process.env.npm_package_version ?? 'dev';
}

function fail(message: string): void {
  console.error(pc.red(message));
  process.exitCode = 1;
}

async function confirm(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} ${pc.dim('(y/N)')} `)).trim().toLowerCase();
    return answer === 'y' || answer === 'yes';
  } finally {
    rl.close();
  }
}

async function roleHere(): Promise<'home' | 'connected' | 'fresh'> {
  const { getInstallationRole } = await import('@/lib/config/role');
  return getInstallationRole();
}

/** The connection and enrollment this computer works from, or a reason it can't. */
function enrolledTarget(): { connection: ConnectionConfig; worker: WorkerConfig; target: WorkerTarget } | string {
  const connection = readConnection();
  if (!connection) return `This computer isn't connected to a home. Run \`${APP_SHORT_ID} connect\` first.`;
  const worker = readWorkerConfig();
  if (!worker) return `This computer isn't enrolled to run agents. Run \`${APP_SHORT_ID} worker enroll\` first.`;
  if (worker.homeId !== connection.homeId) {
    return `This computer's enrollment is for a different home than it's connected to. Run \`${APP_SHORT_ID} worker enroll\` again.`;
  }
  return {
    connection,
    worker,
    target: {
      homeUrl: connection.homeUrl,
      homeId: connection.homeId,
      homeName: connection.homeName,
      computerName: worker.computerName,
      workerKey: worker.workerKey,
    },
  };
}

async function enroll(opts: { code?: string; yes?: boolean }): Promise<void> {
  const role = await roleHere();
  if (role === 'home') {
    return fail(`This computer is your home. Its agents already run here, so it doesn't enroll as a worker.`);
  }
  const connection = readConnection();
  if (!connection) return fail(`This computer isn't connected to a home. Run \`${APP_SHORT_ID} connect\` first.`);

  console.log(
    `Enrolling lets ${pc.bold(connection.homeName)} run agents on this computer: in the folders you set up ` +
      `for them, with the harnesses installed here, under the permissions you choose for each session. ` +
      `You can turn it off here with \`${APP_SHORT_ID} worker disable\`, or from your home's Devices settings.`,
  );
  if (!opts.yes && !(await confirm('Enroll this computer?'))) {
    console.log('Nothing changed.');
    return;
  }

  try {
    let code = opts.code?.trim();
    if (!code) {
      // Ask the home for a grant for this computer, with its viewing key.
      const res = await homeFetch(connection, '/api/workers/grants', { method: 'POST', body: '{}' });
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      if (!res.ok || !body?.code) {
        return fail(body?.message ?? `${connection.homeName} didn't issue an enrollment code (HTTP ${res.status}).`);
      }
      code = body.code;
    }
    const res = await homeFetch(connection, '/api/workers/enroll', {
      method: 'POST',
      body: JSON.stringify({
        code,
        name: os.hostname().replace(/\.local$/, ''),
        platform: process.platform,
        hostname: os.hostname(),
        protocol: WORKER_PROTOCOL,
        version: workerVersion(),
      }),
    });
    const body = (await res.json().catch(() => null)) as {
      homeId?: string;
      computerId?: string;
      computerName?: string;
      workerKey?: string;
      message?: string;
    } | null;
    if (!res.ok || !body?.workerKey || !body.homeId || !body.computerId) {
      return fail(body?.message ?? `${connection.homeName} refused the enrollment (HTTP ${res.status}).`);
    }
    if (body.homeId !== connection.homeId) {
      return fail(`${connection.homeUrl} enrolled this computer with a different home. Nothing was saved.`);
    }
    writeWorkerConfig({
      homeId: body.homeId,
      computerId: body.computerId,
      computerName: body.computerName ?? 'this computer',
      workerKey: body.workerKey,
      enrolledAt: new Date().toISOString(),
    });
    console.log(
      `${pc.green('Enrolled.')} ${pc.bold(body.computerName ?? 'This computer')} can run agents for ${connection.homeName}. ` +
        `Run \`${APP_SHORT_ID} worker run\` to connect.`,
    );
  } catch (err) {
    if (err instanceof HomeRequestError) return fail(err.message);
    throw err;
  }
}

async function run(): Promise<void> {
  const found = enrolledTarget();
  if (typeof found === 'string') return fail(found);
  const { target } = found;
  const { runWorker } = await import('@/lib/worker/run');
  const controller = new AbortController();
  const onSignal = () => controller.abort();
  // `on`, not `once`: tsx exits the process on a signal when no other
  // listener remains, and a `once` listener is removed before it runs, which
  // would cut off the stopped heartbeat below.
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);

  console.log(`${pc.bold(target.computerName)} worker for ${target.homeName}, at ${target.homeUrl}. Ctrl-C to stop.`);
  const { installRunnerSink } = await import('@/lib/runner/sink');
  const { executionHandlers, executionRequests } = await import('@/lib/worker/handlers');
  const { closeIdleSessions } = await import('@/lib/runner/local-runner');
  // Sessions idle for 30 minutes close here as they do at home (P2.1).
  const sweep = setInterval(() => void closeIdleSessions().catch(() => {}), 60_000);
  const exit = await runWorker({
    target,
    version: workerVersion(),
    signal: controller.signal,
    // This computer's runner reports to the worker's journal.
    onSink: installRunnerSink,
    handlers: (journal, extras) => executionHandlers({ journal, ...extras }),
    requests: (journal) => executionRequests({ journal, homeId: target.homeId }),
    onStatus: (status) => {
      const at = new Date().toLocaleTimeString();
      if (status.state === 'connected') console.log(`${pc.dim(at)} ${pc.green('connected')}`);
      else if (status.state === 'disconnected') {
        console.log(`${pc.dim(at)} ${pc.yellow('disconnected')}: ${status.error} Retrying in ${Math.round(status.retryInMs / 1000)}s.`);
      }
    },
  });
  clearInterval(sweep);
  // Stopping the worker stops what it runs here, and tells the home.
  const { finishWorker } = await import('@/lib/worker/run');
  const unclosed = await finishWorker(target, workerVersion(), exit);
  if (unclosed.length > 0) console.log(pc.yellow(`${unclosed.length} session(s) didn't close. Check for leftover harness processes.`));
  process.off('SIGINT', onSignal);
  process.off('SIGTERM', onSignal);

  if (exit.reason === 'stopped') {
    console.log('Stopped.');
    return;
  }
  if (exit.reason === 'revoked') removeWorkerConfig();
  fail(exit.message);
}

async function status(): Promise<void> {
  const found = enrolledTarget();
  if (typeof found === 'string') {
    console.log(found);
    return;
  }
  const { worker, target } = found;
  console.log(`${pc.bold(worker.computerName)} is enrolled with ${target.homeName} (${target.homeUrl}) since ${worker.enrolledAt}.`);
  try {
    const { sendHeartbeat } = await import('@/lib/worker/run');
    await sendHeartbeat(target, workerVersion());
    console.log(`${pc.green('The home accepts this worker.')} Run \`${APP_SHORT_ID} worker run\` to keep it connected.`);
  } catch (err) {
    if (err instanceof WorkerStoppedError || err instanceof WorkerNetworkError) return fail(err.message);
    throw err;
  }
}

async function open(): Promise<void> {
  const found = enrolledTarget();
  if (typeof found === 'string') return fail(found);
  const { target } = found;
  try {
    const res = await workerFetch(target, '/api/workers/me/associations', { method: 'POST' });
    const body = (await res.json().catch(() => null)) as { code?: string } | null;
    if (!res.ok || !body?.code) return fail(`${target.homeName} didn't issue a code (HTTP ${res.status}).`);
    await openBrowser(`${target.homeUrl}/#associate=${encodeURIComponent(body.code)}`);
    console.log(`Opened ${target.homeName} in this computer's browser.`);
  } catch (err) {
    if (err instanceof WorkerStoppedError || err instanceof WorkerNetworkError) return fail(err.message);
    throw err;
  }
}

async function disable(): Promise<void> {
  const found = enrolledTarget();
  if (typeof found === 'string') return fail(found);
  try {
    await workerFetch(found.target, '/api/workers/me', { method: 'DELETE' });
  } catch (err) {
    // Already revoked means already off.
    if (!(err instanceof WorkerStoppedError && err.reason === 'revoked')) {
      if (err instanceof WorkerNetworkError) return fail(`${err.message} Nothing was changed.`);
      throw err;
    }
  }
  removeWorkerConfig();
  console.log(`${found.worker.computerName} no longer runs agents for ${found.target.homeName}. It stays connected.`);
}

async function grant(opts: { computer?: string; name?: string }): Promise<void> {
  if ((await roleHere()) !== 'home') {
    return fail(`Make enrollment codes on your home. On this computer, \`${APP_SHORT_ID} worker enroll\` makes its own.`);
  }
  const { createComputerGrant, GrantError, listComputers } = await import('@/lib/db/queries');
  let computerId: string | null = null;
  if (opts.computer) {
    const wanted = opts.computer.toLowerCase();
    const match = listComputers().filter((c) => c.id === opts.computer || c.name.toLowerCase() === wanted);
    if (match.length !== 1) {
      return fail(match.length === 0 ? `No computer is named "${opts.computer}".` : `More than one computer is named "${opts.computer}". Use its id.`);
    }
    computerId = match[0]!.id;
  } else if (!opts.name) {
    return fail('Name the computer: --computer <existing name> or --name <new name>.');
  }
  try {
    const { grant: issued, secret } = createComputerGrant({
      kind: 'enroll',
      computerId,
      computerName: opts.name ?? null,
      createdByApiKeyId: null,
    });
    console.log(secret);
    console.log(pc.dim(`Works once, until ${new Date(issued.expiresAt).toLocaleTimeString()}. On that computer: ${APP_SHORT_ID} worker enroll --code <code>`));
  } catch (err) {
    if (err instanceof GrantError) return fail(err.message);
    throw err;
  }
}

export function registerWorkerCommand(program: Command) {
  const worker = program.command('worker').description('Run agents on this computer for your home');
  worker
    .command('enroll')
    .description('Let your home run agents on this computer')
    .option('--code <code>', 'an enrollment code made on your home')
    .option('-y, --yes', 'enroll without asking')
    .action(enroll);
  worker.command('run').description('Connect to your home and stay connected').action(run);
  worker.command('status').description("This computer's enrollment").action(status);
  worker.command('open').description("Open your Ri in this computer's browser, as This Mac").action(open);
  worker.command('disable').description('Stop running agents on this computer').action(disable);
  worker
    .command('grant')
    .description('On your home: make a code another computer enrolls with')
    .option('--computer <name>', 'an existing computer, by name or id')
    .option('--name <name>', 'a name for a new computer')
    .action(grant);
}
