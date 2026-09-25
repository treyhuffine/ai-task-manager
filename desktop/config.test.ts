import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { bundledCliCommand, demoEnvironment } from './config';

describe('demo isolation', () => {
  it('does not inherit the real app home or advanced path overrides', () => {
    const original = { NODE_ENV: 'test' as const, RI_ROOT: '/real/home', RI_DB_PATH: '/real/db', RI_CONFIG_DIR: '/real/config', RI_WORK_DIR: '/real/work', ELECTRON_RUN_AS_NODE: '1' };
    const env = demoEnvironment('/checkout', original, 'development');
    expect(env.RI_ROOT).toBe(path.resolve('/checkout/.electron-demo/home'));
    expect(env.RI_DB_PATH).toBe('');
    expect(env.RI_CONFIG_DIR).toBe('');
    expect(env.RI_WORK_DIR).toBe('');
    expect(env.NODE_TLS_REJECT_UNAUTHORIZED).toBe('1');
    expect(env.ELECTRON_RUN_AS_NODE).toBeUndefined();
    expect(env.NEXT_DIST_DIR).toBe('.next-desktop-dev');
    expect(original.RI_ROOT).toBe('/real/home');
  });
  it('honors only an explicit desktop home and keeps a separate production build', () => {
    const env = demoEnvironment('/checkout', { NODE_ENV: 'test', RI_DESKTOP_ROOT: '/demo/home' }, 'production');
    expect(env.RI_ROOT).toBe('/demo/home');
    expect(env.NEXT_DIST_DIR).toBe('.next-desktop');
  });
  it.skipIf(process.platform === 'win32')('quotes spaces, apostrophes and shell substitution in harness CLI paths', () => {
    const command = bundledCliCommand('/usr/bin/printf', "/a repo/it's $(exit 19)", '/a home/$(exit 22)');
    // printf treats the quoted CLI path as its format. An executed substitution
    // would disappear from the output instead of surviving literally.
    expect(execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' })).toBe("/a repo/it's $(exit 19)/dist/cli/index.mjs");
  });
});
