/**
 * Whether this root is a personal home or a team space, and the one check
 * every personal capability makes before it runs (docs/homes-spec.md §9.1,
 * §9.2, P6.3).
 *
 * The kind is a fact: `home.kind`, made from the root's team mark
 * (src/lib/home/team-intent.ts) when the identity is created, and readable
 * from that mark before any database opens. Hiding controls is not the
 * boundary. A team runs no AI, starts no personal background work, and its
 * members reach no personal route, so each personal capability refuses here
 * when it would run in a team, whatever called it.
 *
 * No database import: the worker and the runner, which keep no database,
 * reach these checks through the harness modules. The query layer registers
 * how to read the home's kind (`registerHomeKindReader`), so a server reads
 * the home row as well as the mark, and a process with no database reads
 * the mark alone.
 */

import { getDbPath } from '@/lib/config/paths';
import { readTeamIntent } from '@/lib/home/team-intent';
import { processState } from '@/lib/process-state';

export type AuthorityKind = 'personal' | 'team';

/** A team mark beside a personal home: refused, never guessed at. */
export class AuthorityConflictError extends Error {
  constructor() {
    super('This folder is marked as a team, but its data is a personal Ri. Nothing was started. Move the team mark (.config/team.json) aside to open the personal Ri.');
    this.name = 'AuthorityConflictError';
  }
}

/** A personal capability asked for in a team space. */
export class TeamBoundaryError extends Error {
  readonly code = 'team_boundary';
  constructor(readonly capability: string) {
    super(`${capability} isn't part of a team space.`);
    this.name = 'TeamBoundaryError';
  }
}

export function isTeamBoundaryError(error: unknown): error is TeamBoundaryError {
  return error instanceof Error && (error as Partial<TeamBoundaryError>).code === 'team_boundary';
}

const reader = processState<{ read: (() => AuthorityKind | null) | null }>('home.kind-reader', () => ({ read: null }));

/** How to read the home row's kind. The query layer registers it when it loads. */
export function registerHomeKindReader(read: () => AuthorityKind | null): void {
  reader.read = read;
}

let cached: { dbPath: string; kind: AuthorityKind } | null = null;

/**
 * The kind this root declares from its files alone, for code that runs
 * before a database opens (the service, the CLI). Null when nothing says.
 */
export function declaredAuthorityKind(): AuthorityKind | null {
  return readTeamIntent() ? 'team' : null;
}

/**
 * This root's kind. The home row decides once it exists, and a team mark
 * that disagrees with it is refused. Before the row exists, the mark
 * decides, so the very first start of a team is already a team's.
 */
export function authorityKind(): AuthorityKind {
  const dbPath = getDbPath();
  if (cached && cached.dbPath === dbPath) return cached.kind;
  const declared = declaredAuthorityKind();
  const kind = reader.read ? reader.read() : null;
  if (!kind) return declared ?? 'personal';
  if (declared === 'team' && kind !== 'team') throw new AuthorityConflictError();
  cached = { dbPath, kind };
  return kind;
}

export function isTeamAuthority(): boolean {
  return authorityKind() === 'team';
}

/** Refuse a personal capability in a team space. */
export function assertPersonalCapability(capability: string): void {
  if (isTeamAuthority()) throw new TeamBoundaryError(capability);
}

export function resetAuthorityCache(): void {
  cached = null;
}
