/**
 * `<app> home show` and `<app> home claim`.
 *
 * `show` prints this root's home and the computer it runs on.
 *
 * `claim` makes this computer the host of the home in this root. A root
 * whose data came from somewhere else (a restored backup, a copied folder,
 * a moved home) refuses to act as the home until it is claimed, so two
 * copies never run as one (docs/homes-spec.md §10.3). Claim only the copy
 * that should be the home from now on.
 */

import pc from 'picocolors';
import { Command } from 'commander';
import { getAppRoot } from '@/lib/config/paths';
import { claimHome, describeNeedsClaim, resolveHomeIdentity } from '@/lib/home/identity';

export function registerHomeCommand(program: Command) {
  const home = program.command('home').description("This root's home identity");

  home
    .command('show')
    .description('Show the home in this root and the computer it runs on')
    .action(() => {
      const status = resolveHomeIdentity();
      console.log(`${pc.bold(status.home.name)} ${pc.dim(status.home.id)}`);
      console.log(`  root: ${getAppRoot()}`);
      if (status.state === 'active') {
        console.log(`  runs on: ${status.computer.name} ${pc.dim(status.computer.id)}`);
      } else {
        console.log(pc.yellow(`  not active here: ${describeNeedsClaim(status.reason)}`));
      }
    });

  home
    .command('claim')
    .description('Make this computer the home for the data in this root')
    .action(() => {
      const before = resolveHomeIdentity();
      if (before.state === 'active') {
        console.log(`${before.home.name} already runs on this computer (${before.computer.name}).`);
        return;
      }
      const after = claimHome();
      console.log(pc.green(`${after.home.name} now runs on ${after.computer.name}.`));
      console.log(pc.dim('  Stop any other copy of this home before starting this one.'));
    });
}
