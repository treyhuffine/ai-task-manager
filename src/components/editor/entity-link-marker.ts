/**
 * Pure marker helpers for the editor's entity-link node. Dependency-free so
 * the round-trip contract can be unit-tested without loading Tiptap/React.
 * The wire format must stay identical to src/lib/entity-refs/parse-markers.ts.
 */

export type EntityLinkKind = 'task' | 'note';

/** Matches a `[[task:id]]` / `[[note:id]]` marker at the START of the string. */
export const ENTITY_LINK_RE = /^\[\[(task|note):([A-Za-z0-9_.-]+)\]\]/;

/** The canonical serialized form. */
export function renderEntityLinkMarkdown(kind: EntityLinkKind, id: string): string {
  return `[[${kind}:${id}]]`;
}
