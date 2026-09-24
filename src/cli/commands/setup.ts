/**
 * `<app> setup`: set up agent folders on this computer (docs/homes-spec.md §4).
 *
 *   ri setup                                  check every setup here and report it to the home
 *   ri setup attach <agent> [folder] [--ref alias=value ...]
 *   ri setup ref <agent> <alias> <value>      value: a path, agent:<id>, omit, or unset
 *   ri setup relink <agent> <folder>          after renaming or moving the folder
 *   ri setup restore <agent> [--yes]          rebuild a deleted setup file
 *   ri setup detach <agent>
 *
 * The folder gets a `.ri.local.json` that only this computer uses, kept out
 * of Git. The same commands work on the home and on a connected computer.
 */

import readline from 'node:readline/promises';
import pc from 'picocolors';
import { Command } from 'commander';
import type { ReferenceValue } from '@/lib/setups/local-file';
import type { SetupReport } from '@/lib/setups/resolve';
import {
  attach,
  detach,
  planRestore,
  relink,
  restore,
  setReference,
  SetupError,
  syncSetups,
} from '@/lib/setups/service';
import { setupLinkForThisComputer } from '../lib/setup-link';

function parseValue(raw: string): ReferenceValue | undefined {
  if (raw === 'omit') return null;
  if (raw === 'unset') return undefined;
  if (raw.startsWith('agent:')) return { agentId: raw.slice('agent:'.length) };
  return raw;
}

function describeValue(value: ReferenceValue | undefined): string {
  if (value === undefined) return 'unset';
  if (value === null) return 'left out here';
  if (typeof value === 'string') return value;
  return `agent ${value.agentId}`;
}

function printReport(report: SetupReport, name: string): void {
  const mark = report.status === 'ready' ? pc.green('ready') : pc.yellow(report.status.replace(/_/g, ' '));
  console.log(`${pc.bold(name)}  ${mark}`);
  console.log(`  ${pc.dim('folder')}  ${report.sourcePath}`);
  for (const ref of report.references) {
    const where = ref.path ?? describeValue(ref.value);
    const flag = ref.problem ? pc.yellow(' !') : '';
    console.log(`  ${pc.dim('@' + ref.alias)}  ${where}${flag}`);
  }
  if (report.problem) console.log(`  ${pc.yellow(report.problem)}`);
}

async function withLink<T>(fn: (link: Awaited<ReturnType<typeof setupLinkForThisComputer>>) => Promise<T>): Promise<T | undefined> {
  try {
    return await fn(await setupLinkForThisComputer());
  } catch (err) {
    if (err instanceof SetupError || (err instanceof Error && err.name === 'SetupFileConflictError')) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return undefined;
    }
    throw err;
  }
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function registerSetupCommand(program: Command) {
  const setup = program
    .command('setup')
    .description("Set up agent folders on this computer and report them to your home")
    .action(async () => {
      await withLink(async (link) => {
        const ctx = await link.context();
        const reports = await syncSetups(link, ctx);
        const names = new Map(ctx.agents.map((a) => [a.id, a.name]));
        if (reports.length === 0) {
          console.log(`No agent folders are set up on ${ctx.computerName} yet. Use \`ri setup attach <agent> <folder>\`.`);
          return;
        }
        console.log(pc.dim(`${ctx.computerName}, for ${ctx.homeName}\n`));
        for (const r of reports) {
          printReport(r, names.get(r.agentId) ?? r.agentId);
          console.log();
        }
      });
    });

  setup
    .command('attach <agent> [folder]')
    .description('Set up a folder on this computer for an existing agent (default: the current folder)')
    .option('--ref <alias=value>', 'map a reference: a path, agent:<id>, or omit', collect)
    .action(async (agent: string, folder: string | undefined, opts: { ref?: string[] }) => {
      const references: Record<string, ReferenceValue> = {};
      for (const pair of opts.ref ?? []) {
        const eq = pair.indexOf('=');
        if (eq <= 0) {
          console.error(pc.red(`--ref needs alias=value, got "${pair}"`));
          process.exitCode = 1;
          return;
        }
        const value = parseValue(pair.slice(eq + 1));
        if (value !== undefined) references[pair.slice(0, eq)] = value;
      }
      await withLink(async (link) => {
        const report = await attach(link, { agent, folder: folder ?? process.cwd(), references });
        const ctx = await link.context();
        printReport(report, ctx.agents.find((a) => a.id === report.agentId)?.name ?? agent);
      });
    });

  setup
    .command('ref <agent> <alias> <value>')
    .description('Map one reference on this computer: a path, agent:<id>, omit, or unset')
    .action(async (agent: string, alias: string, raw: string) => {
      await withLink(async (link) => {
        const report = await setReference(link, { agent, alias, value: parseValue(raw) });
        printReport(report, agent);
      });
    });

  setup
    .command('relink <agent> <folder>')
    .description("Point an agent at its folder's new location after a rename or move")
    .action(async (agent: string, folder: string) => {
      await withLink(async (link) => {
        const report = await relink(link, { agent, folder });
        printReport(report, agent);
      });
    });

  setup
    .command('restore <agent>')
    .description('Rebuild a deleted setup file from what your home last saw, after confirming')
    .option('-y, --yes', 'restore without asking')
    .action(async (agent: string, opts: { yes?: boolean }) => {
      await withLink(async (link) => {
        const plan = await planRestore(link, { agent });
        const names = new Map((await link.context()).agents.map((a) => [a.id, a.name]));
        console.log(`Restore ${pc.bold(plan.dir)}/.ri.local.json with:`);
        for (const id of plan.agents) {
          console.log(`  ${names.get(id) ?? id}`);
          for (const [alias, value] of Object.entries(plan.file.agents[id]!.references)) {
            console.log(`    @${alias}  ${describeValue(value)}`);
          }
        }
        if (!opts.yes) {
          if (!process.stdin.isTTY) {
            console.error(pc.yellow('Confirm with --yes to write it.'));
            process.exitCode = 1;
            return;
          }
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          const answer = (await rl.question('Write it? [y/N] ')).trim().toLowerCase();
          rl.close();
          if (answer !== 'y' && answer !== 'yes') {
            console.log('Nothing written.');
            return;
          }
        }
        for (const report of await restore(link, plan)) printReport(report, names.get(report.agentId) ?? report.agentId);
      });
    });

  setup
    .command('detach <agent>')
    .description("Remove an agent's setup from this computer. The folder itself is untouched.")
    .action(async (agent: string) => {
      await withLink(async (link) => {
        await detach(link, { agent });
        console.log(`Removed ${agent}'s setup from this computer.`);
      });
    });
}
