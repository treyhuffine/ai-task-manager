/**
 * What the background service on this computer is for, decided before it
 * starts anything or opens a database (docs/homes-spec.md §3.1,
 * docs/desktop.md "Main integration and Homes handoff", item 1). Read from
 * files only: the connection record, the worker enrollment, and a retired
 * home's note.
 *
 * - `home`: this folder holds a home. The service runs it.
 * - `first-run`: nothing here yet. Starting a home here is a first run.
 * - `worker`: connected to a home elsewhere and enrolled to run its work.
 *   The service runs the worker. The window shows the home.
 * - `viewer`: connected, not enrolled. Nothing runs here. The window shows
 *   the home.
 * - `retired`: the home that was here was retired. Connect to the one that
 *   took over.
 * - `conflict`: both a database and a connection. A person has to choose.
 */

import { getInstallationRole, RoleConflictError } from '@/lib/config/role';
import { readConnection } from '@/lib/connection/config';
import { describeRetired, retiredHomes } from '@/lib/home/retired';
import { readWorkerConfig } from '@/lib/worker/config';

export type ServiceRole =
  | { role: 'home' }
  | { role: 'first-run' }
  | { role: 'worker'; home: { url: string; name: string }; computerName: string }
  | { role: 'viewer'; home: { url: string; name: string } }
  | { role: 'retired'; message: string }
  | { role: 'conflict'; message: string };

export function resolveServiceRole(): ServiceRole {
  let installed: ReturnType<typeof getInstallationRole>;
  try {
    installed = getInstallationRole();
  } catch (err) {
    if (err instanceof RoleConflictError) return { role: 'conflict', message: err.message };
    throw err;
  }
  if (installed === 'home') return { role: 'home' };
  if (installed === 'fresh') {
    const retired = retiredHomes()[0];
    return retired ? { role: 'retired', message: describeRetired(retired.retired, retired.dir) } : { role: 'first-run' };
  }
  const connection = readConnection()!;
  const home = { url: connection.homeUrl, name: connection.homeName };
  let worker: ReturnType<typeof readWorkerConfig> = null;
  try {
    worker = readWorkerConfig();
  } catch {
    // An enrollment this version can't read runs nothing until it's enrolled again.
  }
  if (worker && worker.homeId === connection.homeId) return { role: 'worker', home, computerName: worker.computerName };
  return { role: 'viewer', home };
}

/** Whether the service starts the home's own server for this role. */
export function servesHome(role: ServiceRole): boolean {
  return role.role === 'home' || role.role === 'first-run';
}

/** Why the service doesn't start the home's server here, for its status. */
export function describeServiceRole(role: ServiceRole): string | null {
  switch (role.role) {
    case 'home':
    case 'first-run':
      return null;
    case 'worker':
      return `This computer runs work for ${role.home.name} at ${role.home.url}, which keeps the data. Run its worker here (\`ri worker run\`), not a home.`;
    case 'viewer':
      return `This computer is connected to ${role.home.name} at ${role.home.url}, where the data lives. Nothing runs here.`;
    case 'retired':
    case 'conflict':
      return role.message;
  }
}
