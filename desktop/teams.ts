/**
 * The teams this desktop app opens (docs/homes-spec.md §3.1, P6.2), kept
 * apart from its personal installation: joining or hosting a team never
 * touches the personal Home connection, its worker or its drafts, and a
 * team-only desktop keeps no personal database.
 *
 * `<desktop state>/teams.json` (0600) holds each team's address and this
 * desktop's member key for it, read by Electron main only, and a creation
 * under way, so an interrupted response, a double click or a restart resumes
 * the same team instead of making another.
 */

import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

export interface SavedTeam {
  id: string;
  name: string;
  origin: string;
  memberId: string;
  memberName: string;
  role: 'owner' | 'member';
  /** Credential: Electron main only. */
  token: string;
  /** A team this computer hosts, in its own root. Null for one it joined. */
  hosted: { root: string } | null;
  addedAt: string;
  openedAt: string | null;
}

export interface PendingTeam {
  creationId: string;
  teamName: string;
  ownerName: string;
  root: string;
  port: number | null;
  startedAt: string;
}

export interface TeamsFile {
  version: 1;
  teams: SavedTeam[];
  pending: PendingTeam | null;
}

const EMPTY: TeamsFile = { version: 1, teams: [], pending: null };

export function teamsFile(stateDir: string): string {
  return path.join(stateDir, 'teams.json');
}

export function readTeams(file: string): TeamsFile {
  let text: string;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...EMPTY, teams: [] };
    throw error;
  }
  const parsed = JSON.parse(text) as Partial<TeamsFile>;
  if (parsed.version !== 1 || !Array.isArray(parsed.teams)) throw new Error('The saved teams can’t be read by this version of Ri.');
  return { version: 1, teams: parsed.teams, pending: parsed.pending ?? null };
}

function write(file: string, value: TeamsFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  fs.renameSync(temporary, file);
}

/** Save a team, replacing the earlier record for the same team. */
export function saveTeam(file: string, team: Omit<SavedTeam, 'addedAt' | 'openedAt'> & { addedAt?: string }): SavedTeam {
  const current = readTeams(file);
  const previous = current.teams.find((t) => t.id === team.id);
  const saved: SavedTeam = { ...team, addedAt: previous?.addedAt ?? team.addedAt ?? new Date().toISOString(), openedAt: previous?.openedAt ?? null };
  write(file, { ...current, teams: [...current.teams.filter((t) => t.id !== team.id), saved] });
  return saved;
}

export function markOpened(file: string, id: string): void {
  const current = readTeams(file);
  if (!current.teams.some((t) => t.id === id)) return;
  write(file, { ...current, teams: current.teams.map((t) => (t.id === id ? { ...t, openedAt: new Date().toISOString() } : t)) });
}

export function forgetTeam(file: string, id: string): void {
  const current = readTeams(file);
  write(file, { ...current, teams: current.teams.filter((t) => t.id !== id) });
}

/** The team to open first: the one opened last. */
export function lastOpenedTeam(file: string): SavedTeam | null {
  const { teams } = readTeams(file);
  return [...teams].sort((a, b) => (b.openedAt ?? b.addedAt).localeCompare(a.openedAt ?? a.addedAt))[0] ?? null;
}

/**
 * Begin creating a team, or resume the one under way. The same request
 * (or a retry after a crash) gets the same creation id and folder.
 */
export function beginCreation(file: string, input: { teamName: string; ownerName: string; root: string; port: number | null }): PendingTeam {
  const current = readTeams(file);
  if (current.pending) return current.pending;
  const pending: PendingTeam = {
    creationId: randomBytes(12).toString('base64url'),
    teamName: input.teamName,
    ownerName: input.ownerName,
    root: input.root,
    port: input.port,
    startedAt: new Date().toISOString(),
  };
  write(file, { ...current, pending });
  return pending;
}

export function finishCreation(file: string, creationId: string): void {
  const current = readTeams(file);
  if (current.pending?.creationId !== creationId) return;
  write(file, { ...current, pending: null });
}

/** Cancel a creation that never made its team. One that did is finished instead. */
export function cancelCreation(file: string): void {
  const current = readTeams(file);
  write(file, { ...current, pending: null });
}

/** Where a new hosted team lives by default: its own folder beside this app's state. */
export function defaultTeamRoot(stateDir: string, teamName: string): string {
  const slug = teamName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'team';
  const base = path.join(stateDir, 'teams');
  let candidate = path.join(base, slug);
  for (let n = 2; fs.existsSync(candidate); n++) candidate = path.join(base, `${slug}-${n}`);
  return candidate;
}

/** A team as the setup page may see it: never its key. */
export function teamView(team: SavedTeam) {
  return { id: team.id, name: team.name, origin: team.origin, memberName: team.memberName, role: team.role, hosted: !!team.hosted };
}
