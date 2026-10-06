import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { getDevAppRoot, getProductionAppRoot } from '@/lib/config/paths';
import { homeEnvironment } from './host-info';

describe('homeEnvironment', () => {
  it('names the production, dev and any other home', () => {
    expect(homeEnvironment(getProductionAppRoot())).toBe('production');
    expect(homeEnvironment(`${getProductionAppRoot()}/`)).toBe('production');
    expect(homeEnvironment(getDevAppRoot())).toBe('development');
    expect(homeEnvironment(path.join(os.tmpdir(), 'ri-homes'))).toBe('isolated');
  });
});
