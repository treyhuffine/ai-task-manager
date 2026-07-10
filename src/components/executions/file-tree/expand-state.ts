/**
 * Directory expand/collapse state for the execution file tree.
 *
 * A dir's *default* state is collapsed, except for ancestors of a changed
 * file which auto-expand so the user sees their changes without drilling
 * in. On top of that default sits the user's explicit intent, stored as a
 * sparse map of overrides:
 *
 *   true  = user force-expanded it
 *   false = user force-collapsed it
 *   absent = no override; follow the auto default
 *
 * Keeping the override separate from the auto default is what lets a
 * manual collapse of an auto-expanded folder actually stick. The earlier
 * single-set model unconditionally re-added every changed-file ancestor
 * on each render, so clicking to collapse one of those folders appeared
 * to do nothing — the display recomputed straight back to expanded.
 */

/** true = force open, false = force collapsed, absent = follow default. */
export type ExpandOverrides = Map<string, boolean>;

/**
 * Effective expanded set the tree renders: auto-expand defaults with the
 * user's overrides applied on top.
 */
export function resolveExpanded(
  autoExpanded: ReadonlySet<string>,
  overrides: ReadonlyMap<string, boolean>,
): Set<string> {
  const out = new Set(autoExpanded);
  for (const [path, open] of overrides) {
    if (open) out.add(path);
    else out.delete(path);
  }
  return out;
}

/**
 * Return a new overrides map recording that `path` should be `open`.
 *
 * When the requested state already matches the auto default, the override
 * is pruned rather than stored — the map stays minimal, and a change that
 * later re-appears under an auto-expanded ancestor re-expands cleanly
 * instead of being pinned by a stale redundant entry.
 */
export function setOverride(
  overrides: ReadonlyMap<string, boolean>,
  autoExpanded: ReadonlySet<string>,
  path: string,
  open: boolean,
): ExpandOverrides {
  const next = new Map(overrides);
  if (open === autoExpanded.has(path)) next.delete(path);
  else next.set(path, open);
  return next;
}

/**
 * Flip `path`'s effective state. `currentlyOpen` is read from the
 * resolved effective set so the toggle direction is correct even when the
 * dir is open only because of its auto default.
 */
export function toggleOverride(
  overrides: ReadonlyMap<string, boolean>,
  autoExpanded: ReadonlySet<string>,
  path: string,
  currentlyOpen: boolean,
): ExpandOverrides {
  return setOverride(overrides, autoExpanded, path, !currentlyOpen);
}

/**
 * Force every ancestor directory of `path` open (used after creating a
 * file/folder at depth so it's immediately visible). `path` itself is not
 * expanded — callers pass the leaf and want its containing dirs open.
 */
export function forceOpenAncestors(
  overrides: ReadonlyMap<string, boolean>,
  autoExpanded: ReadonlySet<string>,
  path: string,
): ExpandOverrides {
  if (!path) return new Map(overrides);
  const parts = path.split('/');
  const next = new Map(overrides);
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/');
    if (autoExpanded.has(ancestor)) next.delete(ancestor);
    else next.set(ancestor, true);
  }
  return next;
}

/**
 * Parse the persisted overrides value. Accepts the current format
 * (array of `[path, open]` pairs) and the legacy format (a plain
 * `string[]` of expanded paths, read as all-`true`) so existing sessions
 * keep their expansions. Returns an empty map on anything malformed.
 */
export function parseOverrides(raw: string | null): ExpandOverrides {
  if (!raw) return new Map();
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Map();
    const out: ExpandOverrides = new Map();
    for (const item of parsed) {
      if (typeof item === 'string') {
        out.set(item, true);
      } else if (
        Array.isArray(item) &&
        typeof item[0] === 'string' &&
        typeof item[1] === 'boolean'
      ) {
        out.set(item[0], item[1]);
      }
    }
    return out;
  } catch {
    return new Map();
  }
}

/** Serialize overrides for persistence (round-trips with `parseOverrides`). */
export function serializeOverrides(overrides: ReadonlyMap<string, boolean>): string {
  return JSON.stringify(Array.from(overrides.entries()));
}
