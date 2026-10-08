import { describe, it, expect } from 'vitest';
import {
  anyFolderOpen,
  collapseAll,
  collapseEvery,
  defaultOpen,
  expandAll,
  resolveExpanded,
  setOverride,
  toggleOverride,
  forceOpenAncestors,
  parseExpandState,
  serializeExpandState,
  type ExpandOverrides,
  type ExpandState,
} from './expand-state';

const auto = (...paths: string[]) => new Set(paths);
const ov = (entries: [string, boolean][] = []): ExpandOverrides => new Map(entries);

describe('resolveExpanded', () => {
  it('returns the auto-expand defaults when there are no overrides', () => {
    const out = resolveExpanded(auto('src', 'src/components'), ov());
    expect(out).toEqual(new Set(['src', 'src/components']));
  });

  it('a force-collapse override removes an auto-expanded dir', () => {
    const out = resolveExpanded(auto('src', 'src/components'), ov([['src/components', false]]));
    expect(out.has('src/components')).toBe(false);
    expect(out.has('src')).toBe(true);
  });

  it('a force-open override adds a non-default dir', () => {
    const out = resolveExpanded(auto(), ov([['src/lib', true]]));
    expect(out).toEqual(new Set(['src/lib']));
  });
});

describe('toggleOverride — the regression', () => {
  // The reported bug: a folder containing a changed file (auto-expanded)
  // could not be collapsed, because the effective set unconditionally
  // re-added it every render. Collapsing must now stick.
  it('collapsing an auto-expanded folder makes it collapsed', () => {
    const autoExpanded = auto('src', 'src/components');
    let overrides = ov();

    // User clicks to collapse src/components (currently open via auto).
    overrides = toggleOverride(overrides, autoExpanded, 'src/components', true);
    expect(overrides.get('src/components')).toBe(false);
    expect(resolveExpanded(autoExpanded, overrides).has('src/components')).toBe(false);
  });

  it('re-expanding an auto-expanded folder prunes the override back to default', () => {
    const autoExpanded = auto('src', 'src/components');
    let overrides = ov([['src/components', false]]);

    // Currently collapsed by override; user clicks to re-open.
    overrides = toggleOverride(overrides, autoExpanded, 'src/components', false);
    // Matches the auto default again → override pruned, not stored as true.
    expect(overrides.has('src/components')).toBe(false);
    expect(resolveExpanded(autoExpanded, overrides).has('src/components')).toBe(true);
  });

  it('toggling a normal (non-changed) folder open then closed prunes cleanly', () => {
    const autoExpanded = auto();
    let overrides = ov();

    overrides = toggleOverride(overrides, autoExpanded, 'src/lib', false);
    expect(overrides.get('src/lib')).toBe(true);

    overrides = toggleOverride(overrides, autoExpanded, 'src/lib', true);
    expect(overrides.has('src/lib')).toBe(false);
  });

  it('keeps a folder collapsed even after a new change lands inside it', () => {
    // User collapsed src/components; then another file there changes, so it
    // stays in the auto-expand set. Their explicit collapse must win.
    const overrides = ov([['src/components', false]]);
    const withNewChange = auto('src', 'src/components');
    expect(resolveExpanded(withNewChange, overrides).has('src/components')).toBe(false);
  });
});

describe('setOverride', () => {
  it('prunes a redundant override that restates the auto default', () => {
    // (overrides, autoExpanded, path, open) — opening an already-auto-open dir.
    const out = setOverride(ov(), auto('src'), 'src', true);
    expect(out.has('src')).toBe(false);
  });

  it('stores an override that diverges from the auto default', () => {
    const out = setOverride(ov(), auto('src'), 'src', false);
    expect(out.get('src')).toBe(false);
  });

  it('does not mutate the input map', () => {
    const input = ov([['a', true]]);
    setOverride(input, auto(), 'b', true);
    expect(input).toEqual(ov([['a', true]]));
  });
});

describe('forceOpenAncestors', () => {
  it('force-opens each parent dir of a new deep file', () => {
    const out = forceOpenAncestors(ov(), auto(), 'a/b/c/file.ts');
    expect(out.get('a')).toBe(true);
    expect(out.get('a/b')).toBe(true);
    expect(out.get('a/b/c')).toBe(true);
    // The leaf file itself is not an expandable dir.
    expect(out.has('a/b/c/file.ts')).toBe(false);
  });

  it('clears a prior collapse override on an ancestor so it becomes visible', () => {
    const out = forceOpenAncestors(ov([['a', false]]), auto('a'), 'a/b/file.ts');
    // 'a' is auto-expanded → override pruned (back to open default).
    expect(out.has('a')).toBe(false);
    expect(resolveExpanded(auto('a'), out).has('a')).toBe(true);
    expect(out.get('a/b')).toBe(true);
  });

  it('is a no-op-ish copy for a root-level path (no ancestors)', () => {
    const out = forceOpenAncestors(ov(), auto(), 'file.ts');
    expect(out.size).toBe(0);
  });
});

describe('Collapse all / Expand all', () => {
  // The tree: src/{components,lib}, docs. A change in src/components/a.tsx
  // auto-expands src and src/components.
  const dirs = auto('src', 'src/components', 'src/lib', 'docs');
  const autoExpanded = auto('src', 'src/components');
  const shown = (state: ExpandState) =>
    resolveExpanded(defaultOpen(state.base, autoExpanded, dirs), state.overrides);

  it('expand all opens every folder, auto default or not', () => {
    expect(shown(expandAll())).toEqual(dirs);
  });

  it('expand all opens folders that appear later', () => {
    const state = expandAll();
    const grown = auto(...dirs, 'scripts');
    expect(resolveExpanded(defaultOpen(state.base, autoExpanded, grown), state.overrides).has('scripts')).toBe(true);
  });

  it('expand all stores no per-folder overrides, so a big tree persists small', () => {
    expect(expandAll().overrides.size).toBe(0);
  });

  it('collapse all closes every folder, auto-expanded ones included', () => {
    const before: ExpandState = { base: 'auto', overrides: ov([['docs', true], ['src/lib', true]]) };
    expect(anyFolderOpen(dirs, shown(before))).toBe(true);
    const after = collapseAll(autoExpanded);
    expect(shown(after).size).toBe(0);
    expect(anyFolderOpen(dirs, shown(after))).toBe(false);
  });

  it('collapse all after expand all returns to the auto default, all closed', () => {
    expect(anyFolderOpen(dirs, shown(expandAll()))).toBe(true);
    const after = collapseAll(autoExpanded);
    expect(after.base).toBe('auto');
    expect(shown(after).size).toBe(0);
  });

  it('after collapse all, a change in an untouched folder still opens its way', () => {
    const state = collapseAll(autoExpanded);
    const withNewChange = auto('src', 'src/components', 'docs');
    const out = resolveExpanded(defaultOpen(state.base, withNewChange, dirs), state.overrides);
    expect(out.has('docs')).toBe(true);
    // The folders the user collapsed stay collapsed.
    expect(out.has('src')).toBe(false);
  });

  it('toggling one folder after expand all closes just that folder, then prunes back', () => {
    const state = expandAll();
    const defaults = defaultOpen(state.base, autoExpanded, dirs);
    const closed = toggleOverride(state.overrides, defaults, 'docs', true);
    expect(closed.get('docs')).toBe(false);
    expect(resolveExpanded(defaults, closed).has('docs')).toBe(false);
    expect(toggleOverride(closed, defaults, 'docs', false).has('docs')).toBe(false);
  });

  it('collapseEvery closes every folder search opened by default', () => {
    const results = auto('src', 'src/components');
    expect(resolveExpanded(results, collapseEvery(results)).size).toBe(0);
  });
});

describe('anyFolderOpen', () => {
  it('is false when only folders under a closed top-level folder are open', () => {
    // src/components is open in state, but src is closed, so nothing shows open.
    expect(anyFolderOpen(auto('src', 'src/components'), auto('src/components'))).toBe(false);
  });

  it('is true when a top-level folder is open', () => {
    expect(anyFolderOpen(auto('src', 'docs'), auto('docs'))).toBe(true);
  });

  it('ignores open paths that are no longer folders in the tree', () => {
    expect(anyFolderOpen(auto('src'), auto('gone'))).toBe(false);
  });
});

describe('parseExpandState / serializeExpandState', () => {
  it('round-trips the current format', () => {
    const state: ExpandState = { base: 'open', overrides: ov([['a', true], ['b/c', false]]) };
    expect(parseExpandState(serializeExpandState(state))).toEqual(state);
  });

  it('reads the earlier bare array of pairs as the auto default', () => {
    const raw = JSON.stringify([['a', true], ['b/c', false]]);
    expect(parseExpandState(raw)).toEqual({ base: 'auto', overrides: ov([['a', true], ['b/c', false]]) });
  });

  it('reads the legacy string[] format as all force-open', () => {
    const legacy = JSON.stringify(['src', 'src/components']);
    expect(parseExpandState(legacy)).toEqual({
      base: 'auto',
      overrides: ov([['src', true], ['src/components', true]]),
    });
  });

  it('returns the initial state for null, malformed, or unexpected JSON', () => {
    const initial = { base: 'auto', overrides: ov() };
    expect(parseExpandState(null)).toEqual(initial);
    expect(parseExpandState('not json')).toEqual(initial);
    expect(parseExpandState('42')).toEqual(initial);
    expect(parseExpandState('{"base":"sideways","overrides":"no"}')).toEqual(initial);
  });

  it('ignores malformed entries but keeps well-formed ones', () => {
    const raw = JSON.stringify({ base: 'auto', overrides: [['a', true], ['b', 'nope'], 42, ['c', false]] });
    expect(parseExpandState(raw)).toEqual({ base: 'auto', overrides: ov([['a', true], ['c', false]]) });
  });
});
