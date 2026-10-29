/**
 * `ri restart` and `ri logs` (docs/always-on-spec.md section 4.1). Both act on
 * the Home a command reaches: `--root`, or the installation's default Home.
 */
import fs from 'node:fs';
import type { Command } from 'commander';
import { APP_SHORT_ID } from '@/constants/app';
import { serviceRequest, serviceStatus, type ServiceStatus } from '@/lib/service/client';
import { servicePaths } from '@/lib/service/paths';

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/** Ask the controller to restart its server, then say what happened. */
export async function restartHome(options: { now?: boolean }, deps = { status: serviceStatus, request: serviceRequest, sleep, say: (line: string) => console.info(line) }) {
  const before = await deps.status();
  if (!before) throw new Error(`Ri isn't running here. Start it with \`${APP_SHORT_ID} start\`.`);
  if (!before.origin) throw new Error("This computer doesn't run a Home's server to restart.");
  const count = before.restarts?.count ?? 0;
  await deps.request('/restart', 'POST', 10_000, { now: options.now === true });
  for (let waited = 0; waited < 5 * 60_000; waited += 1000) {
    await deps.sleep(1000);
    let status: ServiceStatus | null;
    try { status = await deps.status(); } catch { continue; }
    if (!status) continue;
    if ((status.restarts?.count ?? 0) > count && status.phase === 'running') { deps.say(`Restarted. Ri is running at ${status.origin}.`); return; }
    if (status.restartPending && !options.now) {
      deps.say(`Ri restarts when ${status.restartPending.waitingFor} finish. To restart now and end them: ${APP_SHORT_ID} restart --now`);
      return;
    }
  }
  deps.say(`Still restarting. Check with \`${APP_SHORT_ID} status\`.`);
}

/** The end of the Home's service log, then new lines as they come with `follow`. */
export async function showLogs(options: { follow?: boolean; lines?: string }, file = servicePaths().log, write: (text: string) => void = text => { process.stdout.write(text); }) {
  if (!fs.existsSync(/* turbopackIgnore: true */ file)) { write('No service log yet.\n'); return; }
  const wanted = Math.max(1, Number(options.lines ?? 200) || 200);
  const fd = fs.openSync(/* turbopackIgnore: true */ file, 'r');
  let position: number;
  try {
    const size = fs.fstatSync(fd).size;
    const bytes = Buffer.alloc(Math.min(size, 1024 * 1024));
    fs.readSync(fd, bytes, 0, bytes.length, size - bytes.length);
    const lines = bytes.toString().split('\n');
    if (lines.at(-1) === '') lines.pop();
    write(`${lines.slice(-wanted).join('\n')}\n`);
    position = size;
  } finally { fs.closeSync(fd); }
  if (!options.follow) return;
  for (;;) {
    await sleep(500);
    const size = fs.statSync(/* turbopackIgnore: true */ file, { throwIfNoEntry: false })?.size ?? 0;
    if (size < position) position = 0;
    if (size === position) continue;
    const handle = fs.openSync(/* turbopackIgnore: true */ file, 'r');
    try {
      const bytes = Buffer.alloc(size - position);
      fs.readSync(handle, bytes, 0, bytes.length, position);
      write(bytes.toString());
      position = size;
    } finally { fs.closeSync(handle); }
  }
}

export function registerHomeControlCommands(program: Command) {
  program.command('restart').description('Restart the Home at the next idle moment')
    .option('--now', "don't wait for running chats, which ends them")
    .option('--root <dir>', 'the Home, when this computer runs several')
    .action(async (options: { now?: boolean }) => restartHome(options));
  program.command('logs').description("Show the Home's service log")
    .option('-f, --follow', 'keep printing new lines')
    .option('-n, --lines <count>', 'how many lines to show', '200')
    .option('--root <dir>', 'the Home, when this computer runs several')
    .action(async (options: { follow?: boolean; lines?: string }) => showLogs(options));
}
