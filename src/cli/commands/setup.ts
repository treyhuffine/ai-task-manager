/**
 * `<app> setup`: an agent's folders on this device (docs/homes-spec.md
 * §4.1-4.2). The home's records are the only place they're kept: these
 * commands record them there, and nothing is written in the folders.
 *
 *   ri setup                                  this device's agents and their folders
 *   ri setup attach <agent> [folder] [--link alias=folder|omit ...]
 *   ri setup link <agent> <alias> <folder|omit>   where a linked folder is here, or go without it
 *   ri setup relink <agent> <folder>          after renaming or moving the folder
 *   ri setup detach <agent>
 *
 * The same commands work on the home and on a connected device.
 */

import fs from 'node:fs';
import path from 'node:path';
import pc from 'picocolors';
import { Command } from 'commander';
import type { WorkspaceSetupWithDevice } from '@/lib/db/queries';
import { dispatchAction } from '../lib/dispatch';
import { SetupCommandError, thisDeviceId, unwrap } from '../lib/setup-link';

/** A folder on this device, as typed: absolute, and there. */
function folderHere(typed: string): string {
  const dir = path.resolve(typed.startsWith('~/') ? path.join(process.env.HOME ?? '', typed.slice(2)) : typed);
  let isDir = false;
  try {
    isDir = fs.statSync(dir).isDirectory();
  } catch {
    /* missing */
  }
  if (!isDir) throw new SetupCommandError(`${dir} doesn't exist or isn't a folder.`);
  return dir;
}

/** `omit` goes without it here. Anything else is a folder here. */
function linkValue(raw: string): string | null {
  if (raw === 'omit') return null;
  if (raw.startsWith('agent:')) {
    throw new SetupCommandError('A linked folder that is another agent is that agent\'s own folder on each device: set that agent up here instead.');
  }
  return folderHere(raw);
}

function printSetup(setup: WorkspaceSetupWithDevice, name: string): void {
  const mark = setup.status === 'ready' ? pc.green('ready') : pc.yellow(setup.status.replace(/_/g, ' '));
  console.log(`${pc.bold(name)}  ${mark}`);
  console.log(`  ${pc.dim('folder')}  ${setup.sourcePath}`);
  for (const ref of setup.references) {
    const where = ref.form === 'omitted' ? 'goes without it here' : ref.form === 'unconfigured' ? 'not chosen here' : (ref.path ?? '?');
    const flag = ref.problem ? pc.yellow(' !') : '';
    console.log(`  ${pc.dim('@' + ref.alias)}  ${where}${flag}`);
  }
  if (setup.problem) console.log(`  ${pc.yellow(setup.problem)}`);
}

async function run(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof SetupCommandError) {
      console.error(pc.red(err.message));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

async function recorded(agent: string, deviceId: string): Promise<WorkspaceSetupWithDevice | null> {
  const setups = unwrap<WorkspaceSetupWithDevice[]>(await dispatchAction('list_workspace_setups', {}));
  const names = await agentNames();
  const id = names.has(agent) ? agent : [...names].find(([, n]) => n.toLowerCase() === agent.toLowerCase())?.[0] ?? agent;
  return setups.find((s) => s.workspaceId === id && s.deviceId === deviceId) ?? null;
}

async function agentNames(): Promise<Map<string, string>> {
  const agents = unwrap<Array<{ id: string; name: string }>>(await dispatchAction('list_workspaces', {}));
  return new Map(agents.map((a) => [a.id, a.name]));
}

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

export function registerSetupCommand(program: Command) {
  const setup = program
    .command('setup')
    .description("Your agents' folders on this device, as your home records them")
    .action(async () => {
      await run(async () => {
        const deviceId = await thisDeviceId();
        const setups = unwrap<Array<WorkspaceSetupWithDevice & { workspaceName: string | null }>>(await dispatchAction('list_workspace_setups', {})).filter(
          (s) => s.deviceId === deviceId,
        );
        if (setups.length === 0) {
          console.log('No agent is set up on this device yet. Use `ri setup attach <agent> <folder>`, or set it up from the app.');
          return;
        }
        console.log(pc.dim(`${setups[0]!.deviceName}\n`));
        for (const s of setups) {
          printSetup(s, s.workspaceName ?? s.workspaceId);
          console.log();
        }
      });
    });

  setup
    .command('attach <agent> [folder]')
    .description('Record the folder an agent is in on this device (default: the current folder)')
    .option('--link <alias=folder>', "where a linked folder is here, or alias=omit to go without it", collect)
    .action(async (agent: string, folder: string | undefined, opts: { link?: string[] }) => {
      await run(async () => {
        const deviceId = await thisDeviceId();
        const dir = folderHere(folder ?? process.cwd());
        const links: Array<[string, string | null]> = [];
        for (const pair of opts.link ?? []) {
          const eq = pair.indexOf('=');
          if (eq <= 0) throw new SetupCommandError(`--link needs alias=folder, got "${pair}"`);
          links.push([pair.slice(0, eq), linkValue(pair.slice(eq + 1))]);
        }
        unwrap(await dispatchAction('set_workspace_folder', { agent, folder: dir, deviceId }));
        for (const [alias, value] of links) {
          unwrap(await dispatchAction('set_linked_folder', { agent, alias, folder: value, deviceId }));
        }
        const now = await recorded(agent, deviceId);
        if (now) printSetup(now, agent);
      });
    });

  for (const name of ['link', 'ref']) {
    setup
      .command(`${name} <agent> <alias> <folder>`)
      .description(name === 'link' ? "Where one of an agent's linked folders is on this device, or omit to go without it" : 'Same as link')
      .action(async (agent: string, alias: string, raw: string) => {
        await run(async () => {
          const deviceId = await thisDeviceId();
          unwrap(await dispatchAction('set_linked_folder', { agent, alias, folder: linkValue(raw), deviceId }));
          const now = await recorded(agent, deviceId);
          if (now) printSetup(now, agent);
        });
      });
  }

  setup
    .command('relink <agent> <folder>')
    .description("Record an agent's folder's new place on this device, after a rename or move")
    .action(async (agent: string, folder: string) => {
      await run(async () => {
        const deviceId = await thisDeviceId();
        unwrap(await dispatchAction('set_workspace_folder', { agent, folder: folderHere(folder), deviceId }));
        const now = await recorded(agent, deviceId);
        if (now) printSetup(now, agent);
      });
    });

  setup
    .command('detach <agent>')
    .description('Take an agent off this device. Its folder itself is untouched.')
    .action(async (agent: string) => {
      await run(async () => {
        const deviceId = await thisDeviceId();
        unwrap(await dispatchAction('remove_workspace_setup', { agent, deviceId }));
        console.log(`Took ${agent} off this device.`);
      });
    });
}
