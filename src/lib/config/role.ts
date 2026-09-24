/**
 * What this data root is (docs/homes-spec.md §2.2, §3.1):
 *
 * - `home`: it holds a database. This is where personal data lives.
 * - `connected`: it holds only a connection record. The data lives in a home
 *   elsewhere, and this root never opens a database of its own.
 * - `fresh`: neither yet. First run decides.
 *
 * A root with both is refused rather than guessed at: a home that was also
 * connected somewhere could write to itself while its person believes the
 * data is elsewhere.
 *
 * No database imports here: `getDb()` uses this to refuse creating a
 * database in a connected root.
 */

import fs from 'node:fs';
import { getConnectionPath, getDbPath } from '@/lib/config/paths';

export type InstallationRole = 'home' | 'connected' | 'fresh';

export class RoleConflictError extends Error {
  constructor() {
    super(
      `This folder holds both a Ri database (${getDbPath()}) and a connection to a home elsewhere ` +
        `(${getConnectionPath()}). Keep one: move the database aside to use this computer through your home, ` +
        'or remove the connection file to use this folder as a home.',
    );
    this.name = 'RoleConflictError';
  }
}

export class ConnectedInstallationError extends Error {
  constructor(action = 'This') {
    super(
      `${action} needs a Ri database, and this computer keeps none: it is connected to your home, ` +
        'where your data lives. Nothing was created here.',
    );
    this.name = 'ConnectedInstallationError';
  }
}

export function getInstallationRole(): InstallationRole {
  const hasDb = fs.existsSync(getDbPath());
  const hasConnection = fs.existsSync(getConnectionPath());
  if (hasDb && hasConnection) throw new RoleConflictError();
  if (hasDb) return 'home';
  if (hasConnection) return 'connected';
  return 'fresh';
}

/** Throw rather than create a database in a connected root. */
export function assertMayCreateDatabase(dbPath: string): void {
  if (fs.existsSync(dbPath)) return;
  if (fs.existsSync(getConnectionPath())) throw new ConnectedInstallationError('Opening data');
}
