import { afterEach, describe, expect, it, vi } from 'vitest';
import { rememberSpacePlace, spacePlaceKey, spaceRecordPath } from './document';

afterEach(() => vi.unstubAllGlobals());

function page(search: string, space?: string) {
  const storage = new Map<string, string>();
  vi.stubGlobal('sessionStorage', { setItem: (key: string, value: string) => storage.set(key, value), getItem: (key: string) => storage.get(key) ?? null });
  vi.stubGlobal('window', { location: { pathname: space ? `/space/${space}` : '/', search } });
  vi.stubGlobal('document', { documentElement: { dataset: space ? { riSpace: space } : {} } });
  return storage;
}

describe('leaving for a team record', () => {
  it('saves the chat it came from, for the selector to return to', () => {
    const storage = page('?session=chat-1');
    rememberSpacePlace();
    expect(storage.get(spacePlaceKey(null))).toBe('/?session=chat-1');
  });

  it('saves a team\'s place under that team', () => {
    const storage = page('?view=notes', 'team-12345');
    rememberSpacePlace();
    expect(storage.get(spacePlaceKey('team-12345'))).toBe('/space/team-12345?view=notes');
  });

  it('goes on without session storage', () => {
    page('');
    vi.stubGlobal('sessionStorage', { setItem() { throw new Error('denied'); } });
    expect(() => rememberSpacePlace()).not.toThrow();
  });

  it('opens each kind at its own address', () => {
    expect(spaceRecordPath('team-12345', 'task', 'a b')).toBe('/space/team-12345?task=a%20b');
    expect(spaceRecordPath('team-12345', 'note', 'n1')).toBe('/space/team-12345?view=notes&note=n1');
    expect(spaceRecordPath('team-12345', 'area', 'a1')).toBe('/space/team-12345?area=a1');
  });
});
