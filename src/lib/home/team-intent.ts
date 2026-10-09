/**
 * The mark that makes a root a team space before anything starts in it
 * (docs/homes-spec.md §9.1, P6.1).
 *
 * A team is never a personal home with a flag flipped later. The trusted
 * creation flow (the desktop's Create a team, or `ri team create` on a
 * server) writes `<config>/team.json` into a fresh root first. Identity is
 * then made as `team` from the outset (src/lib/home/identity.ts), and the
 * root's kind can be read from files alone, before a database opens, so the
 * service and the server never start personal work there
 * (src/lib/home/authority.ts).
 *
 * The file stays for the life of the root. It holds no credential.
 */

import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteFile } from '@/lib/config/atomic-write';
import { getConfigDir, getConnectionPath, getDbPath } from '@/lib/config/paths';
import { retiredHomes } from '@/lib/home/retired';

export const TEAM_INTENT_FILE = 'team.json';
export const TEAM_INTENT_VERSION = 1;
/** What a team is called until its owner names it. */
export const DEFAULT_TEAM_NAME = 'Team';
export const TEAM_NAME_MAX = 80;

export interface TeamIntent {
  version: typeof TEAM_INTENT_VERSION;
  kind: 'team';
  /** One creation attempt. Writing again with the same id resumes it. */
  creationId: string;
  /** The name it was created with. Editable later, and never its identity. */
  name: string;
  createdAt: string;
}

export class TeamIntentError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TeamIntentError';
  }
}

export function teamIntentPath(configDir: string = getConfigDir()): string {
  return path.join(configDir, TEAM_INTENT_FILE);
}

/** A trimmed team name, or the default when none was given. */
export function normalizeTeamName(name: string | null | undefined): string {
  const trimmed = (name ?? '').replace(/\s+/g, ' ').trim();
  if (trimmed.length > TEAM_NAME_MAX) throw new TeamIntentError(`A team name can be at most ${TEAM_NAME_MAX} characters.`);
  return trimmed || DEFAULT_TEAM_NAME;
}

/**
 * The root's team mark, or null when it has none. Read from the file alone.
 * A mark that isn't a private file owned by this user, or that this version
 * can't read, is refused rather than ignored: ignoring it would start the
 * root as a personal home.
 */
export function readTeamIntent(configDir: string = getConfigDir()): TeamIntent | null {
  const file = teamIntentPath(configDir);
  let stat: fs.Stats;
  try {
    stat = fs.lstatSync(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0 || (process.getuid && stat.uid !== process.getuid())) {
    throw new TeamIntentError(`${file} must be a private file owned by this user. Nothing was started.`);
  }
  let parsed: Partial<TeamIntent>;
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<TeamIntent>;
  } catch {
    throw new TeamIntentError(`${file} can't be read. Nothing was started.`);
  }
  if (parsed.version !== TEAM_INTENT_VERSION || parsed.kind !== 'team' || typeof parsed.creationId !== 'string' || !parsed.creationId) {
    throw new TeamIntentError(`${file} is from another version of Ri. Update Ri to open this team. Nothing was started.`);
  }
  return {
    version: TEAM_INTENT_VERSION,
    kind: 'team',
    creationId: parsed.creationId,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name : DEFAULT_TEAM_NAME,
    createdAt: typeof parsed.createdAt === 'string' ? parsed.createdAt : new Date(0).toISOString(),
  };
}

/**
 * Mark a fresh root as a team. Retry-safe: the same `creationId` returns the
 * mark it already wrote. Refuses a root that holds anything else, so a
 * personal home, a connected device or a retired home is never turned into a
 * team.
 */
export function writeTeamIntent(input: { creationId: string; name?: string | null }, configDir: string = getConfigDir()): TeamIntent {
  if (!/^[A-Za-z0-9_-]{8,80}$/.test(input.creationId)) throw new TeamIntentError('A team creation needs an id.');
  const existing = readTeamIntent(configDir);
  if (existing) {
    if (existing.creationId === input.creationId) return existing;
    throw new TeamIntentError('This folder already holds a team. Choose an empty folder for a new one.');
  }
  if (fs.existsSync(getDbPath()) || fs.existsSync(getConnectionPath()) || retiredHomes().length > 0) {
    throw new TeamIntentError('A team needs an empty folder of its own. This one already holds a Ri, and it was left unchanged.');
  }
  if (fs.existsSync(path.join(configDir, 'desktop-role.json'))) {
    throw new TeamIntentError('This folder was chosen for a personal Ri. Choose an empty folder for a team.');
  }
  const intent: TeamIntent = {
    version: TEAM_INTENT_VERSION,
    kind: 'team',
    creationId: input.creationId,
    name: normalizeTeamName(input.name),
    createdAt: new Date().toISOString(),
  };
  atomicWriteFile(teamIntentPath(configDir), JSON.stringify(intent, null, 2) + '\n');
  return intent;
}
