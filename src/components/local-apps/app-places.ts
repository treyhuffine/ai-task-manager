/**
 * Which apps the rail lists, and when a rail row is the one on screen.
 * Pure, so the rail's rows and its tests agree (docs/rail.md).
 */

export interface AppPlace {
  id: string;
  slug: string;
  displayName: string;
  /** An action is waiting on the person's approval. */
  needsApproval: boolean;
}

interface ListedInstance {
  id: string;
  slug: string;
  displayName: string;
  enabled: boolean;
  archived: boolean;
}

/**
 * The apps a person can open: enabled and not archived, by name. A disabled
 * or archived app can't open, so it waits in the library with its state
 * rather than taking a row it can't honor.
 */
export function appPlaces(
  instances: readonly ListedInstance[],
  approvals: readonly { instanceId: string }[],
): AppPlace[] {
  const waiting = new Set(approvals.map((approval) => approval.instanceId));
  return instances
    .filter((item) => item.enabled && !item.archived)
    .map((item) => ({
      id: item.id,
      slug: item.slug,
      displayName: item.displayName,
      needsApproval: waiting.has(item.id),
    }))
    .sort((a, b) => a.displayName.localeCompare(b.displayName));
}

/** The `/apps/<route>` an installed app owns: its root and anything under it. */
export function isAppRoute(route: string, slug: string): boolean {
  return route === slug || route.startsWith(`${slug}/`);
}

/** The routes the library row stands for: the library itself and the drafts it lists. */
export function isLibraryRoute(route: string): boolean {
  return route === '' || route === 'new' || route.startsWith('drafts/');
}

/** The library's route for a draft, and an app's for a path inside it. */
export const draftRoute = (id: string) => `drafts/${id}`;
