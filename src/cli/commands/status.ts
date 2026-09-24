/**
 * `<app> status`: what this folder is and where its home is, in any role.
 *
 * - On a home: the home, the computer it runs on, and whether this copy is
 *   the active one.
 * - On a connected computer: which home, its address, and whether it answers
 *   for this computer right now.
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

export function registerStatusCommand(program: Command) {
  program
    .command('status')
    .description('Show what this folder is: a home, a computer connected to one, or not set up')
    .action(async () => {
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
          console.log(`${pc.dim('runs on')} ${status.computer.name}`);
        } else {
          console.log(pc.yellow(`${pc.dim('state')}   not active here. ${describeNeedsClaim(status.reason)}`));
        }
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
    });
}
