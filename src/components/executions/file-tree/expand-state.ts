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
 *
 * Expand all swaps the default itself (`base: 'open'`) instead of storing
 * an override per folder, so the persisted state stays small on a big
 * tree and folders that appear later open too. Collapse all goes back to
 * the auto default with every auto-expanded folder force-collapsed, which
 * is exactly what collapsing each open folder by hand would leave.
 *
 * The functions below take `defaults`, the set of folders open with no
 * override: `defaultOpen` gives it for a persisted state, and search mode
 * passes every folder in its results.
 */

/**
 * What a folder with no override does: `auto` opens only the ancestors of
 * a changed file, `open` (after Expand all) opens every folder.
 */
export type ExpandBase = 'auto' | 'open';

/** true = force open, false = force collapsed, absent = follow default. */
export type ExpandOverrides = Map<string, boolean>;

/** A tree's persisted expand state: the default, and the user's overrides on top. */
export interface ExpandState {
  base: ExpandBase;
  overrides: ExpandOverrides;
}

/**
 * The folders open by default under `base`: the auto-expanded ancestors of
 * changes, or every folder in the tree after Expand all.
 */
export function defaultOpen(
  base: ExpandBase,
  autoExpanded: ReadonlySet<string>,
  dirPaths: ReadonlySet<string>,
): ReadonlySet<string> {
  return base === 'open' ? dirPaths : autoExpanded;
}

/** Expand all: every folder opens, including ones that appear later. */
export function expandAll(): ExpandState {
  return { base: 'open', overrides: new Map() };
}

/**
 * Collapse all: back to the auto default with each auto-expanded folder
 * force-collapsed, the same state as collapsing every open folder by hand.
 * A change that lands later in a folder the user never touched still opens
 * its way, as it would after any manual collapse.
 */
export function collapseAll(autoExpanded: ReadonlySet<string>): ExpandState {
  return { base: 'auto', overrides: collapseEvery(autoExpanded) };
}

/** Overrides that close every folder in `defaults`, so none is left open. */
export function collapseEvery(defaults: Iterable<string>): ExpandOverrides {
  const overrides: ExpandOverrides = new Map();
  for (const path of defaults) overrides.set(path, false);
  return overrides;
}

/**
 * Whether the tree shows any folder open. Only top-level folders need
 * checking: a visible open folder has every ancestor open, so the tree
 * looks fully collapsed exactly when no top-level folder is open, whatever
 * state the folders inside them keep.
 */
export function anyFolderOpen(
  dirPaths: Iterable<string>,
  expanded: ReadonlySet<string>,
): boolean {
  for (const path of dirPaths) {
    if (!path.includes('/') && expanded.has(path)) return true;
  }
  return false;
}

/**
 * Effective expanded set the tree renders: the default-open folders with
 * the user's overrides applied on top.
 */
export function resolveExpanded(
  defaults: ReadonlySet<string>,
  overrides: ReadonlyMap<string, boolean>,
): Set<string> {
  const out = new Set(defaults);
  for (const [path, open] of overrides) {
    if (open) out.add(path);
    else out.delete(path);
  }
  return out;
}

/**
 * Return a new overrides map recording that `path` should be `open`.
 *
 * When the requested state already matches the default, the override is
 * pruned rather than stored — the map stays minimal, and a change that
 * later re-appears under an auto-expanded ancestor re-expands cleanly
 * instead of being pinned by a stale redundant entry.
 */
export function setOverride(
  overrides: ReadonlyMap<string, boolean>,
  defaults: ReadonlySet<string>,
  path: string,
  open: boolean,
): ExpandOverrides {
  const next = new Map(overrides);
  if (open === defaults.has(path)) next.delete(path);
  else next.set(path, open);
  return next;
}

/**
 * Flip `path`'s effective state. `currentlyOpen` is read from the
 * resolved effective set so the toggle direction is correct even when the
 * dir is open only because of its default.
 */
export function toggleOverride(
  overrides: ReadonlyMap<string, boolean>,
  defaults: ReadonlySet<string>,
  path: string,
  currentlyOpen: boolean,
): ExpandOverrides {
  return setOverride(overrides, defaults, path, !currentlyOpen);
}

/**
 * Force every ancestor directory of `path` open (used after creating a
 * file/folder at depth so it's immediately visible). `path` itself is not
 * expanded — callers pass the leaf and want its containing dirs open.
 */
export function forceOpenAncestors(
  overrides: ReadonlyMap<string, boolean>,
  defaults: ReadonlySet<string>,
  path: string,
): ExpandOverrides {
  if (!path) return new Map(overrides);
  const parts = path.split('/');
  const next = new Map(overrides);
  for (let i = 1; i < parts.length; i++) {
    const ancestor = parts.slice(0, i).join('/');
    if (defaults.has(ancestor)) next.delete(ancestor);
    else next.set(ancestor, true);
  }
  return next;
}

/**
 * Parse the persisted expand state. The current format is
 * `{ base, overrides }` with overrides as `[path, open]` pairs. Two older
 * formats still read, as `base: 'auto'`: a bare array of pairs, and a
 * plain `string[]` of expanded paths (all `true`), so existing sessions
 * keep their expansions. Anything malformed reads as the initial state.
 */
export function parseExpandState(raw: string | null): ExpandState {
  if (!raw) return { base: 'auto', overrides: new Map() };
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed)) return { base: 'auto', overrides: parseOverrideList(parsed) };
    if (parsed && typeof parsed === 'object') {
      const { base, overrides } = parsed as { base?: unknown; overrides?: unknown };
      return {
        base: base === 'open' ? 'open' : 'auto',
        overrides: Array.isArray(overrides) ? parseOverrideList(overrides) : new Map(),
      };
    }
  } catch {
    /* fall through */
  }
  return { base: 'auto', overrides: new Map() };
}

function parseOverrideList(list: unknown[]): ExpandOverrides {
  const out: ExpandOverrides = new Map();
  for (const item of list) {
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
}

/** Serialize the expand state for persistence (round-trips with `parseExpandState`). */
export function serializeExpandState(state: ExpandState): string {
  return JSON.stringify({ base: state.base, overrides: Array.from(state.overrides.entries()) });
}
