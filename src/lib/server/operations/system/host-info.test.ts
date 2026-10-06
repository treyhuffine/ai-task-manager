import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDevAppRoot, getProductionAppRoot } from '@/lib/config/paths';
import { homeEnvironment } from './host-info';

describe('homeEnvironment', () => {
  it('marks the dev home and any development server', () => {
    expect(homeEnvironment(getDevAppRoot(), 'production')).toBe('development');
    expect(homeEnvironment(path.join(os.tmpdir(), 'ri-homes'), 'development')).toBe('development');
  });

  it("treats every production server as production, wherever its home is", () => {
    expect(homeEnvironment(getProductionAppRoot(), 'production')).toBe('production');
    // The desktop app's own home, a team space, an end user's custom root.
    expect(homeEnvironment(path.join(os.homedir(), 'Library/Application Support/Ri/home'), 'production')).toBe('production');
    expect(homeEnvironment(path.join(os.tmpdir(), 'ri-team-space'), 'production')).toBe('production');
  });
});
