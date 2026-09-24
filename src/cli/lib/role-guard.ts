/**
 * Keep commands that need a home's data from running where there is none
 * (docs/homes-spec.md §3.1).
 *
 * - On a home, everything runs as before.
 * - On a fresh root, a data command would quietly create a new home, which
 *   is how a laptop used to become a second Ri. Refuse and point at `ri`,
 *   which asks whether to start a home or connect to one.
 * - On a connected computer the data lives in the home. Commands in
 *   `ROUTED_WHEN_CONNECTED` handle that themselves by calling the home.
 *   Everything else is refused with where the home is.
 *
 * `getDb()` refuses to create a database on a connected computer as well,
 * so a command missing from this list still can't write locally.
 */

import type { Command } from 'commander';
import { APP_SHORT_ID } from '@/constants/app';
import { getInstallationRole } from '@/lib/config/role';
import { readConnection } from '@/lib/connection/config';

/** Top-level commands that read or write a home's data. */
const DATA_COMMANDS = new Set([
  'agent',
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
 * Data commands that reach the home over its API when this computer is
 * connected (src/cli/lib/dispatch.ts). `browser` stays refused: it drives a
 * browser on the machine it runs on, and a connected computer's own browser
 * is not the home's.
 */
export const ROUTED_WHEN_CONNECTED = new Set(['agent', 'trigger', 'runs', 'run', 'spend', 'setup']);

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

/** Why `commandName` can't run in this root, or null when it can. */
export function refusalFor(commandName: string): string | null {
  if (!DATA_COMMANDS.has(commandName)) return null;
  const role = getInstallationRole();
  if (role === 'home') return null;
  if (role === 'fresh') {
    return `Ri isn't set up on this computer yet. Run \`${APP_SHORT_ID}\` to start using Ri here or connect to your existing Ri.`;
  }
  if (ROUTED_WHEN_CONNECTED.has(commandName)) return null;
  const connection = readConnection();
  const where = connection ? `${connection.homeName} at ${connection.homeUrl}` : 'your home';
  return `This computer is connected to ${where}, where your data lives. \`${APP_SHORT_ID} ${commandName}\` runs on the home itself.`;
}

export function installRoleGuard(program: Command): void {
  program.hook('preAction', (_thisCommand, actionCommand) => {
    const refusal = refusalFor(topLevelName(actionCommand));
    if (refusal) throw new RoleGuardError(refusal);
  });
}
