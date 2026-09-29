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
import { confirm, isCancel, select } from '@clack/prompts';
import { getAppRoot, getDbPath } from '@/lib/config/paths';
import { claimHome, describeNeedsClaim, resolveHomeIdentity } from '@/lib/home/identity';
import { describeRetired, retiredHomes } from '@/lib/home/retired';

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? '' : 's'}`;

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
    .option('--as <computer>', "which of the home's computers this is, by name or id, or `new`")
    .action(async (opts: { as?: string }) => {
      const before = resolveHomeIdentity();
      if (before.state === 'active' && !opts.as) {
        console.log(`${before.home.name} already runs on this computer (${before.computer.name}).`);
        return;
      }
      const { listComputers, getComputer } = await import('@/lib/db/queries');
      const computers = listComputers();
      let as: string | undefined;
      if (opts.as) {
        const wanted = opts.as.trim();
        const match = wanted.toLowerCase() === 'new' ? 'new' : computers.find((c) => c.id === wanted || c.name.toLowerCase() === wanted.toLowerCase())?.id;
        if (!match) {
          console.error(`${wanted} isn't a computer of this home. Its computers: ${computers.map((c) => c.name).join(', ')}, or \`new\`.`);
          process.exitCode = 1;
          return;
        }
        as = match;
      } else if (process.stdin.isTTY && computers.length > 0) {
        // Restored on the computer that ran it, moved to one that already ran
        // its work, or new to it: the person knows, so ask rather than guess.
        const host = getComputer(before.home.hostComputerId);
        const choice = await select({
          message: 'Which computer is this?',
          options: [
            ...computers.map((c) => ({ value: c.id, label: c.name, hint: c.id === host?.id ? 'hosted this home until now' : 'one of its computers' })),
            { value: 'new', label: 'A computer new to this home' },
          ],
        });
        if (isCancel(choice)) {
          console.log('Nothing changed.');
          return;
        }
        as = String(choice);
      }
      const after = claimHome({ as });
      console.log(pc.green(`${after.home.name} now runs on ${after.computer.name}.`));
      if (after.moved) {
        const from = getComputer(after.moved.from)?.name ?? 'the computer it ran on';
        console.log(
          pc.dim(
            `  What ran on ${from} stays there: ${count(after.moved.pinnedExecutions, 'execution')} and ${count(after.moved.pinnedChats, 'chat')}. ` +
              `${count(after.moved.freshChats, 'chat')} start fresh here. ${from} can connect to this home and run work (\`ri connect\`, then \`ri worker enroll\`).`,
          ),
        );
      }
      console.log(pc.dim('  Stop and retire any other copy of this home before starting this one (`ri home retire` there).'));
    });

  home
    .command('export <dir>')
    .description('Export this stopped home, verified, to move it to another computer')
    .action(async (dir: string) => {
      const { exportHome, MoveError } = await import('@/lib/home/move');
      try {
        const manifest = await exportHome(dir);
        const mb = (manifest.files.reduce((n, f) => n + f.size, 0) / 1e6).toFixed(1);
        console.log(pc.green(`Exported to ${dir}: ${count(manifest.files.length, 'file')}, ${mb} MB, verified.`));
        console.log(
          [
            '  Next:',
            `  1. Copy ${dir} to the computer that will be your home.`,
            '  2. There, in a folder of its own: `ri home import <dir>`.',
            '  3. Here: `ri home retire --to <its address>`, so this one never runs beside it.',
            '  4. There: `ri home claim`, then `ri start`.',
          ].join('\n'),
        );
      } catch (err) {
        if (err instanceof MoveError) {
          console.error(err.message);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
    });

  home
    .command('import <dir>')
    .description('Import an exported home into this folder, to become its home here once claimed')
    .action(async (dir: string) => {
      const { importHome, MoveError } = await import('@/lib/home/move');
      try {
        const manifest = importHome(dir);
        console.log(pc.green(`Imported ${count(manifest.files.length, 'file')} into ${getAppRoot()}, verified.`));
        console.log(
          [
            "  It won't run until it's claimed here. Next:",
            '  1. Where it ran until now: `ri home retire --to <this address>`.',
            '  2. Here: `ri home claim`, then `ri start`.',
          ].join('\n'),
        );
      } catch (err) {
        if (err instanceof MoveError) {
          console.error(err.message);
          process.exitCode = 1;
          return;
        }
        throw err;
      }
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
