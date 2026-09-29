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
 *
 * `retire` sets the stopped home in this root aside for good, after its work
 * moved into another home (src/lib/home/retire.ts): nothing is deleted, the
 * folder's worktrees stay, and it can then connect to that home. `--undo`
 * brings it back.
 */

import fs from 'node:fs';
import pc from 'picocolors';
import { Command } from 'commander';
import { confirm, isCancel } from '@clack/prompts';
import { getAppRoot, getDbPath } from '@/lib/config/paths';
import { claimHome, describeNeedsClaim, resolveHomeIdentity } from '@/lib/home/identity';
import { describeRetired, retiredHomes } from '@/lib/home/retired';

export function registerHomeCommand(program: Command) {
  const home = program.command('home').description("This root's home identity");

  home
    .command('show')
    .description('Show the home in this root and the computer it runs on')
    .action(() => {
      const retired = retiredHomes()[0];
      if (retired && !fs.existsSync(getDbPath())) {
        console.log(pc.yellow(describeRetired(retired.retired, retired.dir)));
        return;
      }
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

  home
    .command('retire')
    .description("Set this folder's stopped home aside for good, after its work moved into another home")
    .option('--to <where>', 'where its work lives now, to say so here: a name or an address')
    .option('--undo', 'bring back the home retired last in this folder')
    .option('-y, --yes', 'retire without asking')
    .action(async (opts: { to?: string; undo?: boolean; yes?: boolean }) => {
      const { retireHome, undoRetire, RetireError } = await import('@/lib/home/retire');
      try {
        if (opts.undo) {
          const back = undoRetire();
          console.log(pc.green(`${back.retired.homeName} is this folder's home again, as it was on ${back.retired.retiredAt.slice(0, 10)}.`));
          return;
        }
        if (!opts.yes) {
          if (!process.stdin.isTTY) {
            console.error('Pass --yes to retire this home without asking.');
            process.exitCode = 1;
            return;
          }
          const answer = await confirm({
            message: `Retire the home in ${getAppRoot()}? Its data is kept in this folder, and nothing is deleted. It won't start as a home again unless you undo this.`,
          });
          if (isCancel(answer) || answer !== true) {
            console.log('Nothing changed.');
            return;
          }
        }
        const done = retireHome({ successor: opts.to ?? null });
        console.log(pc.green(`Retired ${done.retired.homeName}. Its data is in ${done.dir}.`));
        console.log(pc.dim('  Worktrees and everything else in this folder stay where they are.'));
        console.log(pc.dim('  To use this computer with your home now: `ri connect`, then `ri worker enroll` to run work here.'));
      } catch (err) {
        if (err instanceof RetireError) {
          console.error(err.message);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });
}
