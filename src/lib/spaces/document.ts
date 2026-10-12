/**
 * A team inside My Ri (docs/homes-spec.md §3.2, P7.1). Selecting a team opens
 * it as a document of its own, `/space/<team id>`, on this home's address.
 * Its pages are the team's own app, and its API calls go through this home to
 * the team, as this person's member: `/api/space/<team id>/...`.
 *
 * A document of its own keeps the spaces apart by construction: its caches,
 * drafts and search belong to that team, and nothing personal mounts there,
 * so switching never mixes them or touches running work.
 *
 * Client and server safe: no imports.
 */

/** `<html data-ri-space>`: the team a space document shows. */
export const SPACE_HEADER = 'x-ri-space';

/** A team's id as it appears in a space address. */
export const SPACE_ID_PATTERN = /^[A-Za-z0-9_-]{8,80}$/;

export const SPACE_PATH_PREFIX = '/space/';

/** The team this document shows, or null in My Ri itself. */
export function currentSpaceId(): string | null {
  if (typeof document === 'undefined') return null;
  const id = document.documentElement.dataset.riSpace;
  return id && SPACE_ID_PATTERN.test(id) ? id : null;
}

export function spacePath(teamId: string): string {
  return `${SPACE_PATH_PREFIX}${encodeURIComponent(teamId)}`;
}

/** Where a space document reaches its team's API through this home. */
export function spaceApiBase(teamId: string): string {
  return `/api/space/${encodeURIComponent(teamId)}`;
}

/** The team id in a `/space/<id>` page address, or null. */
export function spaceIdFromPath(pathname: string): string | null {
  if (!pathname.startsWith(SPACE_PATH_PREFIX)) return null;
  const id = decodeURIComponent(pathname.slice(SPACE_PATH_PREFIX.length).split('/')[0] ?? '');
  return SPACE_ID_PATTERN.test(id) ? id : null;
}

/**
 * A shared body as a space document shows it: the team's files are reached
 * through this home. The team stores them as `/api/attachments/<file>`, and
 * `bodyForTeam` turns them back before a save, so the team's own members
 * never see this home's address in a body.
 */
export function bodyForDocument(body: string, teamId: string | null): string {
  return teamId ? body.replaceAll('/api/attachments/', `${spaceApiBase(teamId)}/attachments/`) : body;
}

export function bodyForTeam(body: string, teamId: string | null): string {
  return teamId ? body.replaceAll(`${spaceApiBase(teamId)}/attachments/`, '/api/attachments/') : body;
}
