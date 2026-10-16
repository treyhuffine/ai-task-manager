import { describe, expect, it } from 'vitest';
import { appPlaces, connectedRoute, isAppRoute, isLibraryRoute, isPlaceRoute } from './app-places';

const app = (over: Partial<Parameters<typeof appPlaces>[0][number]>) => ({
  id: over.id ?? over.slug ?? 'x',
  slug: over.slug ?? 'x',
  displayName: over.displayName ?? 'X',
  enabled: over.enabled ?? true,
  archived: over.archived ?? false,
  hasView: over.hasView ?? true,
});

const connected = (over: Partial<NonNullable<Parameters<typeof appPlaces>[2]>[number]>) => ({
  id: over.id ?? 'server',
  toolkitName: over.toolkitName ?? 'Server',
  providerId: over.providerId,
  available: over.available ?? true,
});

describe('appPlaces', () => {
  it('lists enabled, unarchived apps by name', () => {
    const places = appPlaces(
      [
        app({ slug: 'tracker', displayName: 'Personal tracker' }),
        app({ slug: 'finances', displayName: 'Finances' }),
        app({ slug: 'old', displayName: 'Archived one', archived: true }),
        app({ slug: 'off', displayName: 'Disabled one', enabled: false }),
        app({ slug: 'tools', displayName: 'Tools only', hasView: false }),
      ],
      [],
    );
    expect(places.map((p) => p.route)).toEqual(['finances', 'tracker']);
  });

  it('marks the app whose action waits on an approval', () => {
    const places = appPlaces([app({ id: 'a', slug: 'a' }), app({ id: 'b', slug: 'b' })], [{ instanceId: 'b' }]);
    expect(places.map((p) => [p.route, p.needsApproval])).toEqual([
      ['a', false],
      ['b', true],
    ]);
  });

  it('lists connections with an interface among installed apps, by name', () => {
    const places = appPlaces(
      [app({ slug: 'finances', displayName: 'Finances' })],
      [],
      [
        connected({ id: 'todoist-1', toolkitName: 'Todoist', providerId: 'todoist' }),
        connected({ id: 'calc', toolkitName: 'Calculator' }),
      ],
    );
    expect(places.map((p) => [p.displayName, p.route, p.mark])).toEqual([
      ['Calculator', '~connected/calc', { kind: 'server' }],
      ['Finances', 'finances', { kind: 'app', icon: undefined }],
      ['Todoist', '~connected/todoist-1', { kind: 'provider', providerId: 'todoist' }],
    ]);
  });

  it("gives a provider's accounts one row, opening the first that can open", () => {
    const [todoist, ...rest] = appPlaces(
      [],
      [],
      [
        connected({ id: 'signed-out', toolkitName: 'Todoist', providerId: 'todoist', available: false }),
        connected({ id: 'work', toolkitName: 'Todoist', providerId: 'todoist' }),
        connected({ id: 'home', toolkitName: 'Todoist', providerId: 'todoist' }),
      ],
    );
    expect(rest).toEqual([]);
    expect(todoist).toMatchObject({ route: '~connected/work', needsApproval: false });
    // Its row stays lit on any account's page, including one that can't open yet.
    for (const id of ['signed-out', 'work', 'home']) expect(isPlaceRoute(todoist!, connectedRoute(id))).toBe(true);
  });

  it('keeps custom servers apart, even with the same name', () => {
    const places = appPlaces([], [], [connected({ id: 'a', toolkitName: 'Docs' }), connected({ id: 'b', toolkitName: 'Docs' })]);
    expect(places.map((p) => p.route)).toEqual(['~connected/a', '~connected/b']);
  });

  it('leaves a connection that is off or signed out to the library', () => {
    const places = appPlaces(
      [],
      [],
      [
        connected({ id: 'off', toolkitName: 'Notion', providerId: 'notion', available: false }),
        connected({ id: 'custom-off', toolkitName: 'Custom', available: false }),
      ],
    );
    expect(places).toEqual([]);
  });
});

describe('routes', () => {
  it('an app owns its root and the paths under it, not a sibling with the same prefix', () => {
    expect(isAppRoute('finances', 'finances')).toBe(true);
    expect(isAppRoute('finances/views/1', 'finances')).toBe(true);
    expect(isAppRoute('finances-2', 'finances')).toBe(false);
    expect(isAppRoute('', 'finances')).toBe(false);
  });

  it('a row is on screen on any of its roots', () => {
    const roots = [connectedRoute('a'), connectedRoute('b')];
    expect(isPlaceRoute({ roots }, '~connected/b')).toBe(true);
    expect(isPlaceRoute({ roots }, '~connected/ab')).toBe(false);
    expect(isPlaceRoute({ roots }, '')).toBe(false);
  });

  it('the library row stands for the library and its drafts', () => {
    expect(isLibraryRoute('')).toBe(true);
    expect(isLibraryRoute('new')).toBe(true);
    expect(isLibraryRoute('drafts/abc')).toBe(true);
    expect(isLibraryRoute('finances')).toBe(false);
    expect(isLibraryRoute('~connected/a')).toBe(false);
  });
});
