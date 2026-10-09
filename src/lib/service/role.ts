/**
 * What the background service on this device is for, decided before it
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

import { hasDesktopHomeIntent } from './desktop-role-intent';
import { readTeamIntent } from '@/lib/home/team-intent';
import { getInstallationRole, RoleConflictError } from '@/lib/config/role';
import { readConnection } from '@/lib/connection/config';
import { describeRetired, retiredHomes } from '@/lib/home/retired';
import { readWorkerConfig } from '@/lib/worker/config';

export type ServiceRole =
  | { role: 'home' }
  | { role: 'first-run' }
  | { role: 'worker'; home: { url: string; name: string }; deviceName: string }
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
    // Retain an unreadable/future enrollment. Never silently downgrade a
    // worker to a viewer or suggest discarding its local execution history.
    return { role: 'conflict', message: 'The local worker enrollment needs attention. Update or repair this installation without removing its files.' };
  }
  if (worker && worker.homeId === connection.homeId && (!connection.deviceId || connection.deviceId === worker.deviceId)) return { role: 'worker', home, deviceName: worker.deviceName };
  return { role: 'viewer', home };
}

/**
 * Whether the service starts the home's own server for this role. A fresh
 * root marked as a team starts its team's server: the mark is the explicit
 * choice, written by the trusted creation flow (src/lib/home/team-intent.ts).
 */
export function servesHome(role: ServiceRole): boolean {
  return role.role === 'home' || (role.role === 'first-run' && (hasDesktopHomeIntent() || readTeamIntent() !== null));
}

/** Why the service doesn't start the home's server here, for its status. */
export function describeServiceRole(role: ServiceRole): string | null {
  switch (role.role) {
    case 'home':
    case 'first-run':
      return null;
    case 'worker':
      return `This device runs work for ${role.home.name} at ${role.home.url}, which keeps the data. Its background service runs local execution.`;
    case 'viewer':
      return `This device is connected to ${role.home.name} at ${role.home.url}, where the data lives. Nothing runs here.`;
    case 'retired':
    case 'conflict':
      return role.message;
  }
}
