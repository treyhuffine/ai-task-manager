/**
 * How many previews a window has open, for the quiet stretch before an update
 * (docs/always-on-spec.md 7.2). The preview pane polls every few seconds, and that
 * poll marks a live preview as viewed (`getPreviewState`), so a recent mark means
 * someone is watching it now.
 */
import { countPreviewsViewedSince } from '@/lib/db/queries';

const WATCHING_MS = 30_000;

export function viewedPreviews(now = Date.now()) {
  return countPreviewsViewedSince(new Date(now - WATCHING_MS).toISOString());
}
