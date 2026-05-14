'use client';

import { Fragment } from 'react';

interface HighlightedTextProps {
  text: string;
  /** Case-insensitive substring to highlight. Empty/null disables highlighting. */
  query: string | null | undefined;
}

/**
 * Renders `text` with every occurrence of `query` (case-insensitive)
 * wrapped in a `<mark>`. Used by the file tree to make the search hit
 * jump out — without it, narrow rows scroll past faster than the eye
 * can scan for the match.
 *
 * Intentionally simple: substring match only, no fuzzy ranking, and we
 * only highlight on the displayed `text` (basename in 'all' mode, full
 * path in 'changed' mode). Matches that live entirely inside an
 * intermediate directory segment won't be highlighted in the row, but
 * the row is still visible because the filter happens off the full
 * path upstream.
 */
export function HighlightedText({ text, query }: HighlightedTextProps) {
  if (!query) return <>{text}</>;
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  if (!q) return <>{text}</>;

  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let idx = lower.indexOf(q, cursor);
  let key = 0;
  while (idx !== -1) {
    if (idx > cursor) parts.push(<Fragment key={key++}>{text.slice(cursor, idx)}</Fragment>);
    parts.push(
      <mark
        key={key++}
        className="rounded-sm bg-amber-300/40 px-0 py-0 text-foreground dark:bg-amber-500/30"
      >
        {text.slice(idx, idx + q.length)}
      </mark>,
    );
    cursor = idx + q.length;
    idx = lower.indexOf(q, cursor);
  }
  if (cursor < text.length) parts.push(<Fragment key={key++}>{text.slice(cursor)}</Fragment>);
  return <>{parts}</>;
}
