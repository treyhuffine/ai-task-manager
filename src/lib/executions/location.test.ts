import { describe, expect, it } from 'vitest';
import { locationLabel, preparedFolder } from './location';

const at = (location: { isHome: boolean; folder: string | null } | null, worktreePath: string | null = null) => ({
  worktreePath,
  location: location && { computerId: 'c', name: location.isHome ? 'Mac Mini' : 'MacBook', ...location },
});

describe('preparedFolder', () => {
  it("is the home's worktree for work at home, and the laptop's folder for work there", () => {
    expect(preparedFolder(at({ isHome: true, folder: null }, '/home/wt'))).toBe('/home/wt');
    expect(preparedFolder(at({ isHome: true, folder: null }))).toBeNull();
    // The regression: a laptop execution never has a home worktree, so it read as setting up forever.
    expect(preparedFolder(at({ isHome: false, folder: '/Users/trey/wt' }))).toBe('/Users/trey/wt');
    expect(preparedFolder(at({ isHome: false, folder: null }))).toBeNull();
  });
});

describe('locationLabel', () => {
  it('names only the exception: a computer away from the home, never the home', () => {
    expect(locationLabel(at({ isHome: false, folder: null }), false)).toBe('MacBook');
    expect(locationLabel(at({ isHome: false, folder: null }), true)).toBe('MacBook');
    expect(locationLabel(at({ isHome: true, folder: null }), true)).toBeNull();
    expect(locationLabel(at(null), true)).toBeNull();
  });

  it('names the home too when asked to always, once there are other computers', () => {
    expect(locationLabel(at({ isHome: false, folder: null }), false, 'always')).toBe('MacBook');
    expect(locationLabel(at({ isHome: true, folder: null }), false, 'always')).toBeNull();
    expect(locationLabel(at({ isHome: true, folder: null }), true, 'always')).toBe('Mac Mini');
  });
});
