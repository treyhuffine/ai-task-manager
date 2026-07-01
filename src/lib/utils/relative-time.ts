import { normalizeTimestamp } from './timestamps';

/**
 * Compact relative-time formatting for tight UI surfaces (left rail, badges).
 * Returns short forms: "now", "5m", "2h", "3d", "2w", "Mar 12".
 *
 * Accepts both stored formats: ISO (`toISOString`) and SQLite space-format
 * (`datetime('now')`). The latter is normalized to explicit UTC first —
 * otherwise `new Date(...)` would read it as local time and skew the
 * elapsed value by the viewer's UTC offset.
 */
export function formatCompactRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const norm = normalizeTimestamp(iso);
  const then = new Date(norm).getTime();
  if (Number.isNaN(then)) return '';
  const diffMs = Date.now() - then;
  const sec = Math.floor(diffMs / 1000);
  if (sec < 30) return 'now';
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h`;
  const days = Math.floor(hr / 24);
  if (days < 7) return `${days}d`;
  if (days < 28) return `${Math.floor(days / 7)}w`;
  return new Date(norm).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
