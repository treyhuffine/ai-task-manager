/**
 * Pure derivation: the set of outgoing edges a source's text declares.
 * Reused by the in-transaction fast path, read-repair, and full rebuild
 * in queries.ts. No DB, no React. See docs/entity-links-spec.md §5.3.
 */

import { extractEntityMarkers } from './extract-links';

export type LinkEntityType = 'task' | 'note';

export interface DerivedEdge {
  targetType: LinkEntityType;
  targetId: string;
}

/**
 * Deduped edges declared across the given texts (task passes
 * [description, body]; note passes [body]). Markers inside code are
 * ignored (via extractEntityMarkers). Scratchpad/file markers are
 * dropped. Self-links are KEPT — the invariant is "iff the text has a
 * resolvable marker to T", and a note may legitimately link itself; the
 * backlinks panel filters self at render (docs/entity-links-spec.md §2).
 */
export function linksFromTexts(texts: Array<string | null | undefined>): DerivedEdge[] {
  const out = new Map<string, DerivedEdge>();
  for (const text of texts) {
    for (const m of extractEntityMarkers(text)) {
      if (m.kind !== 'task' && m.kind !== 'note') continue; // drop scratchpad
      out.set(`${m.kind}:${m.id}`, { targetType: m.kind, targetId: m.id });
    }
  }
  return [...out.values()];
}
