/**
 * Keep commands that need a home's data from running where there is none
 * (docs/homes-spec.md §3.1).
 *
 * - On a home, everything runs as before.
 * - On a fresh root, a data command would quietly create a new home, which
 *   is how a laptop used to become a second Ri. Refuse and point at `ri`,
 *   which asks whether to start a home or connect to one. A fresh root whose
 *   home was retired says so instead, and still runs `home`, to show or undo
 *   the retirement.
 * - On a connected device the data lives in the home. Commands in
 *   `ROUTED_WHEN_CONNECTED` handle that themselves by calling the home.
 *   Everything else is refused with where the home is.
 *
 * `getDb()` refuses to create a database on a connected device as well,
 * so a command missing from this list still can't write locally.
 */

import type { Command } from 'commander';
import { APP_SHORT_ID } from '@/constants/app';
import { getInstallationRole } from '@/lib/config/role';
import { readConnection } from '@/lib/connection/config';
import { describeRetired, retiredHomes } from '@/lib/home/retired';
import { readTeamIntent } from '@/lib/home/team-intent';

/** Top-level commands that read or write a home's data. */
const DATA_COMMANDS = new Set([
  'agent',
  'attachment',
  'trigger',
  'runs',
  'run',
  'spend',
  'browser',
  'snapshot',
  'commit',
  'export',
  'pair',
  'onboard',
  'home',
  'setup',
]);

/**
 * Data commands that reach the home over its API when this device is
 * connected (src/cli/lib/dispatch.ts). `browser` stays refused: it drives a
 * browser on the machine it runs on, and a connected device's own browser
 * is not the home's.
 */
export const ROUTED_WHEN_CONNECTED = new Set(['attachment', 'agent', 'trigger', 'runs', 'run', 'spend', 'setup']);

function isTeamFolder(): boolean {
  try {
    return readTeamIntent() !== null;
  } catch {
    return true;
  }
}

export class RoleGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RoleGuardError';
  }
}

function topLevelName(command: Command): string {
  let c: Command = command;
  while (c.parent && c.parent.parent) c = c.parent;
  return c.name();
}

/** Why `commandName` (and its subcommand) can't run in this root, or null when it can. */
/**
 * What a team space's folder runs: its own commands and the server's
 * lifecycle. Everything personal (agents, triggers, the browser, pairing,
 * setup, snapshots) belongs to a person's home (docs/homes-spec.md §9.2).
 */
const TEAM_COMMANDS = new Set(['team', 'start', 'stop', 'status', 'service', 'update', 'tls', 'perf', 'help']);

export function refusalFor(commandName: string, subcommand?: string): string | null {
  if (isTeamFolder() && !TEAM_COMMANDS.has(commandName) && !(commandName === 'home' && subcommand === 'show')) {
    return `This folder holds a team. \`${APP_SHORT_ID} ${commandName}\` is part of a personal Ri. Use \`${APP_SHORT_ID} team\` here.`;
  }
  if (!DATA_COMMANDS.has(commandName)) return null;
  const role = getInstallationRole();
  if (role === 'home') return null;
  // A moved home arrives in a folder that has none yet.
  if (role === 'fresh' && commandName === 'home' && subcommand === 'import') return null;
  if (role === 'fresh') {
    // A folder whose home was retired: say so, and let `home` show it or undo it.
    const retired = retiredHomes()[0];
    if (retired) return commandName === 'home' ? null : describeRetired(retired.retired, retired.dir);
    return `Ri isn't set up on this device yet. Run \`${APP_SHORT_ID}\` to start using Ri here or connect to your existing Ri.`;
  }
  if (ROUTED_WHEN_CONNECTED.has(commandName)) return null;
  const connection = readConnection();
  const where = connection ? `${connection.homeName} at ${connection.homeUrl}` : 'your home';
  return `This device is connected to ${where}, where your data lives. \`${APP_SHORT_ID} ${commandName}\` runs on the home itself.`;
}

export function installRoleGuard(program: Command): void {
  program.hook('preAction', (_thisCommand, actionCommand) => {
    const top = topLevelName(actionCommand);
    const refusal = refusalFor(top, actionCommand.name() === top ? undefined : actionCommand.name());
    if (refusal) throw new RoleGuardError(refusal);
  });
}
