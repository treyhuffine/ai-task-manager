import { describe, it, expect } from 'vitest';
import {
  resolveExpanded,
  setOverride,
  toggleOverride,
  forceOpenAncestors,
  parseOverrides,
  serializeOverrides,
  type ExpandOverrides,
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

describe('parseOverrides / serializeOverrides', () => {
  it('round-trips the current pair format', () => {
    const map = ov([['a', true], ['b/c', false]]);
    expect(parseOverrides(serializeOverrides(map))).toEqual(map);
  });

  it('reads the legacy string[] format as all force-open', () => {
    const legacy = JSON.stringify(['src', 'src/components']);
    expect(parseOverrides(legacy)).toEqual(ov([['src', true], ['src/components', true]]));
  });

  it('returns an empty map for null, malformed, or non-array JSON', () => {
    expect(parseOverrides(null)).toEqual(ov());
    expect(parseOverrides('not json')).toEqual(ov());
    expect(parseOverrides('{"a":1}')).toEqual(ov());
  });

  it('ignores malformed entries but keeps well-formed ones', () => {
    const raw = JSON.stringify([['a', true], ['b', 'nope'], 42, ['c', false]]);
    expect(parseOverrides(raw)).toEqual(ov([['a', true], ['c', false]]));
  });
});
