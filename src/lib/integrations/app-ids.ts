/**
 * Names for personal apps' connections (docs/personal-apps.md), with no server imports, so the
 * screens and the server agree on them.
 *
 * An app is one connector, `app_<slug>`, with one account per place. A place is Ri's own chats or
 * one agent, and its account ID names it, so an agent's scope pins exactly its own connection.
 */

/** Where a connection is used: Ri's own chats (its main chat, tasks and notes), or one agent. */
export type McpAppPlace = { kind: 'ri' } | { kind: 'agent'; workspaceId: string };

export const APP_TOOLKIT_PREFIX = 'app_';
export const appToolkitId = (slug: string) => `${APP_TOOLKIT_PREFIX}${slug}`;
export const isAppToolkitId = (toolkitId: string) => toolkitId.startsWith(APP_TOOLKIT_PREFIX);

/** The account an app's connection is for: the place. */
export function appPlaceAccountId(place: McpAppPlace): string {
  return place.kind === 'ri' ? 'place:ri' : `place:agent:${place.workspaceId}`;
}

export function samePlace(a: McpAppPlace, b: McpAppPlace): boolean {
  return appPlaceAccountId(a) === appPlaceAccountId(b);
}
