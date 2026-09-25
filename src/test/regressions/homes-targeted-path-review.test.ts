/**
 * Regressions from the targeted review of 1d76d11: the reviewer's probes of
 * the path walker, kept as written. Three reproduced `link/..` escaping the
 * isolation check; the rest confirmed cases that already held.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { canonicalPath } from '@/lib/config/canonical-path';
import { checkResolvedPaths } from '@/lib/config/dev-isolation';

let base: string;
let isolated: string;
let protectedRoot: string;
beforeEach(() => {
  base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ri-targeted-path-')));
  isolated = path.join(base, 'isolated');
  protectedRoot = path.join(base, 'protected');
  fs.mkdirSync(isolated);
  fs.mkdirSync(path.join(protectedRoot, 'child'), { recursive: true });
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(base, { recursive: true, force: true });
});
function resolved(workDir = path.join(isolated, '.work')) {
  return {
    appRoot: isolated,
    dbPath: path.join(isolated, 'data.db'),
    configDir: path.join(isolated, '.config'),
    workDir,
    attachmentsDir: path.join(isolated, 'attachments'),
  };
}

describe('targeted canonical-path probes', () => {
  it('handles the macOS /var and /tmp links', () => {
    for (const dir of ['/var', '/tmp']) {
      expect(canonicalPath(dir)).toBe(fs.realpathSync(dir));
    }
    const viaVar = base.replace(/^\/private\/var\//, '/var/');
    expect(canonicalPath(viaVar)).toBe(base);
    const tmp = fs.mkdtempSync('/tmp/ri-targeted-tmp-');
    try {
      expect(canonicalPath(tmp)).toBe(fs.realpathSync(tmp));
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('follows ordinary relative and dangling links into protected locations', () => {
    const target = path.join(protectedRoot, 'not-created');
    fs.symlinkSync('../protected/not-created', path.join(isolated, '.work'));
    expect(canonicalPath(resolved().workDir)).toBe(target);
    expect(checkResolvedPaths(resolved(), isolated, [protectedRoot]).length).toBeGreaterThan(0);
  });

  it('does not collapse an input .. before resolving the preceding link', () => {
    fs.symlinkSync(path.join(protectedRoot, 'child'), path.join(isolated, 'bridge'));
    const raw = `${isolated}/bridge/..`;
    fs.writeFileSync(`${raw}/input-probe`, 'synthetic protected write');
    expect(fs.readFileSync(path.join(protectedRoot, 'input-probe'), 'utf8')).toBe('synthetic protected write');
    expect(checkResolvedPaths(resolved(raw), isolated, [protectedRoot]).length).toBeGreaterThan(0);
    expect(canonicalPath(raw)).toBe(protectedRoot);
  });

  it('does not collapse .. in a link target before resolving the preceding link', () => {
    fs.symlinkSync(path.join(protectedRoot, 'child'), path.join(isolated, 'bridge'));
    fs.symlinkSync('bridge/..', path.join(isolated, '.work'));
    // Demonstrate the actual filesystem destination without touching real protected data.
    fs.writeFileSync(path.join(resolved().workDir, 'probe'), 'synthetic protected write');
    expect(fs.readFileSync(path.join(protectedRoot, 'probe'), 'utf8')).toBe('synthetic protected write');
    expect(checkResolvedPaths(resolved(), isolated, [protectedRoot]).length).toBeGreaterThan(0);
  });

  it('also detects a dangling target after link/..', () => {
    fs.symlinkSync(path.join(protectedRoot, 'child'), path.join(isolated, 'bridge'));
    fs.symlinkSync('bridge/../new.db', path.join(isolated, 'data.db'));
    fs.writeFileSync(resolved().dbPath, 'synthetic protected database');
    expect(fs.existsSync(path.join(protectedRoot, 'new.db'))).toBe(true);
    expect(checkResolvedPaths(resolved(), isolated, [protectedRoot]).length).toBeGreaterThan(0);
  });

  it('fails closed on relative link loops', () => {
    fs.symlinkSync('b', path.join(isolated, 'a'));
    fs.symlinkSync('a', path.join(isolated, 'b'));
    expect(checkResolvedPaths(resolved(path.join(isolated, 'a')), isolated, [protectedRoot]).join('\n')).toMatch(/loop|symlinks/);
  });

  it('fails closed if readlink cannot read a link', () => {
    const link = path.join(isolated, '.work');
    fs.symlinkSync(protectedRoot, link);
    const readlink = fs.readlinkSync.bind(fs);
    vi.spyOn(fs, 'readlinkSync').mockImplementation(((p: fs.PathLike, ...args: unknown[]) => {
      if (String(p) === link) throw Object.assign(new Error('simulated unreadable link'), { code: 'EACCES' });
      return (readlink as (...args: unknown[]) => string)(p, ...args);
    }) as typeof fs.readlinkSync);
    expect(checkResolvedPaths(resolved(), isolated, [protectedRoot]).join('\n')).toMatch(/can't be read/);
  });

  it('fails closed on an unreadable ancestor', () => {
    const locked = path.join(isolated, 'locked');
    fs.mkdirSync(locked);
    fs.symlinkSync(protectedRoot, path.join(locked, 'link'));
    fs.chmodSync(locked, 0);
    try {
      expect(checkResolvedPaths(resolved(path.join(locked, 'link')), isolated, [protectedRoot]).join('\n')).toMatch(/EACCES/);
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });
});
