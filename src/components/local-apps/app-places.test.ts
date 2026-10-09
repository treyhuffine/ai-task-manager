import { describe, expect, it } from 'vitest';
import { appPlaces, isAppRoute, isLibraryRoute } from './app-places';

const app = (over: Partial<Parameters<typeof appPlaces>[0][number]>) => ({
  id: over.id ?? over.slug ?? 'x',
  slug: over.slug ?? 'x',
  displayName: over.displayName ?? 'X',
  enabled: over.enabled ?? true,
  archived: over.archived ?? false,
});

describe('appPlaces', () => {
  it('lists enabled, unarchived apps by name', () => {
    const places = appPlaces(
      [
        app({ slug: 'tracker', displayName: 'Personal tracker' }),
        app({ slug: 'finances', displayName: 'Finances' }),
        app({ slug: 'old', displayName: 'Archived one', archived: true }),
        app({ slug: 'off', displayName: 'Disabled one', enabled: false }),
      ],
      [],
    );
    expect(places.map((p) => p.slug)).toEqual(['finances', 'tracker']);
  });

  it('marks the app whose action waits on an approval', () => {
    const places = appPlaces([app({ id: 'a', slug: 'a' }), app({ id: 'b', slug: 'b' })], [{ instanceId: 'b' }]);
    expect(places.map((p) => [p.slug, p.needsApproval])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });
});

describe('routes', () => {
  it('an app owns its root and the paths under it, not a sibling with the same prefix', () => {
    expect(isAppRoute('finances', 'finances')).toBe(true);
    expect(isAppRoute('finances/views/1', 'finances')).toBe(true);
    expect(isAppRoute('finances-2', 'finances')).toBe(false);
    expect(isAppRoute('', 'finances')).toBe(false);
  });

  it('the library row stands for the library and its drafts', () => {
    expect(isLibraryRoute('')).toBe(true);
    expect(isLibraryRoute('new')).toBe(true);
    expect(isLibraryRoute('drafts/abc')).toBe(true);
    expect(isLibraryRoute('finances')).toBe(false);
  });
});
