/**
 * `<app> status`: what this folder is and where its home is, in any role.
 *
 * - On a home: the home, the device it runs on, and whether this copy is
 *   the active one.
 * - On a connected device: which home, its address, and whether it answers
 *   for this device right now.
 * - On a fresh root: that nothing is set up yet.
 */

import pc from 'picocolors';
import { Command } from 'commander';
import { APP_SHORT_ID } from '@/constants/app';
import { getAppRoot } from '@/lib/config/paths';
import { getInstallationRole } from '@/lib/config/role';
import { readConnection } from '@/lib/connection/config';
import { checkHome, HomeRequestError } from '@/lib/connection/home-client';
import { describeNeedsClaim, resolveHomeIdentity } from '@/lib/home/identity';
import { serviceStatus } from '@/lib/service/client';
import { hasLoginSupervision } from '@/lib/service/supervision-state';
import { readStopped } from '@/lib/service/stopped';
import { latestRelease, listHomes, storeDirectory, type InstalledHome } from '@/lib/service/store';
import { canonical } from '@/lib/service/paths';
import { displayRoot, withHomeIdentity } from '@/lib/service/update-run';
import { readLiveServerRuntime } from '@/lib/server-runtime/record';
import { releaseCommit } from '@/lib/service/source-build';
import { describeHomeStatus, homeIsDown, summarizeHome } from '@/lib/service/home-status';
import fs from 'node:fs';
import path from 'node:path';

/** What `ri status` reports about the Home the environment names. */
async function homeFacts() {
  const status = await serviceStatus().catch(() => null);
  return { status, supervised: hasLoginSupervision(), stopped: readStopped(), computer: computerRelease(),
    homeCommit: status?.repo ? releaseCommit(status.repo) : null,
    // The service publishes the same record, so only without one was this started by hand.
    manual: status ? null : readLiveServerRuntime()?.publicBaseUrl ?? null, now: Date.now() };
}

/** Every other Home the installation runs, one line each, so a team that's
 * down can't hide behind a healthy personal Home. */
async function printOtherHomes() {
  const here = canonical(getAppRoot());
  const others = listHomes().filter((home): home is InstalledHome & { identity: NonNullable<InstalledHome['identity']> } => !!home.identity && home.identity.root !== here);
  if (!others.length) return;
  console.log(`\n${pc.dim('other Homes on this computer')}`);
  for (const home of others) {
    const facts = await withHomeIdentity(home.identity, homeFacts);
    const line = `${displayRoot(home.identity.root)}  ${summarizeHome(facts)}`;
    console.log(homeIsDown(facts) ? pc.red(line) : line);
    if (homeIsDown(facts)) process.exitCode = 1;
  }
}

/** The newest release on this computer, what `ri` itself runs. */
function computerRelease() {
  const id = latestRelease();
  if (!id) return null;
  const repo = path.join(/* turbopackIgnore: true */ storeDirectory(), id, 'server');
  try {
    const version = JSON.parse(fs.readFileSync(/* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ repo, 'package.json'), 'utf8')).version as string;
    return { version, commit: releaseCommit(repo) };
  } catch { return null; }
}

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show what this folder is and whether every Home on this computer is running')
    .option('--root <dir>', 'only this Home')
    .action(async (opts: { root?: string }) => {
      console.log(`${pc.dim('folder')}  ${getAppRoot()}`);
      let role;
      try {
        role = getInstallationRole();
      } catch (err) {
        console.log(pc.red(err instanceof Error ? err.message : String(err)));
        process.exitCode = 1;
        return;
      }

      if (role === 'fresh') {
        console.log(`${pc.dim('role')}    not set up. Run \`${APP_SHORT_ID}\` to start using Ri or connect to your existing Ri.`);
        return;
      }

      if (role === 'home') {
        const status = resolveHomeIdentity();
        console.log(`${pc.dim('role')}    home`);
        console.log(`${pc.dim('home')}    ${status.home.name} ${pc.dim(status.home.id)}`);
        if (status.state === 'active') {
          console.log(`${pc.dim('runs on')} ${status.device.name}`);
        } else {
          console.log(pc.yellow(`${pc.dim('state')}   not active here. ${describeNeedsClaim(status.reason)}`));
          return;
        }
        const facts = await homeFacts();
        for (const [label, value] of describeHomeStatus(facts)) {
          const text = `${pc.dim(label.padEnd(7))} ${value}`;
          console.log(label === 'error' ? pc.red(text) : text);
        }
        if (homeIsDown(facts)) process.exitCode = 1;
        if (!opts.root) await printOtherHomes();
        return;
      }

      const connection = readConnection()!;
      console.log(`${pc.dim('role')}    connected to a home`);
      console.log(`${pc.dim('home')}    ${connection.homeName} ${pc.dim(connection.homeId)}`);
      console.log(`${pc.dim('address')} ${connection.homeUrl}`);
      try {
        const home = await checkHome(connection);
        console.log(`${pc.dim('state')}   ${pc.green('reachable')}, running on ${home.host.name}`);
      } catch (err) {
        if (!(err instanceof HomeRequestError)) throw err;
        console.log(`${pc.dim('state')}   ${pc.red(err.message)}`);
        process.exitCode = 1;
      }
      if (!opts.root) await printOtherHomes();
    });
}
