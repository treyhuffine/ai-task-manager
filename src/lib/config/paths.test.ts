/**
 * Which home a development launch opens. A harness session's `ri` launcher
 * pins the home that started the session, so from a production session's
 * shell `RI_ROOT` names production, and `--dev` must still mean the dev home.
 */

import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { APP_ROOT_ENV, getAppRoot, getDevAppRoot, getProductionAppRoot, resolveDevAppRoot } from './paths';

let saved: string | undefined;
beforeEach(() => { saved = process.env[APP_ROOT_ENV]; });
afterEach(() => {
  if (saved === undefined) delete process.env[APP_ROOT_ENV];
  else process.env[APP_ROOT_ENV] = saved;
});

describe('resolveDevAppRoot', () => {
  it('is the dev home when nothing names a root', () => {
    delete process.env[APP_ROOT_ENV];
    expect(resolveDevAppRoot()).toBe(getDevAppRoot());
  });

  it('is the dev home when RI_ROOT names production, however it is spelled', () => {
    process.env[APP_ROOT_ENV] = getProductionAppRoot();
    expect(resolveDevAppRoot()).toBe(getDevAppRoot());
    process.env[APP_ROOT_ENV] = `${getProductionAppRoot()}/`;
    expect(resolveDevAppRoot()).toBe(getDevAppRoot());
  });

  it('keeps another explicit root', () => {
    const other = path.join(os.tmpdir(), 'ri-some-other-home');
    process.env[APP_ROOT_ENV] = other;
    expect(resolveDevAppRoot()).toBe(other);
  });

  it('leaves production where every helper falls back', () => {
    delete process.env[APP_ROOT_ENV];
    expect(getAppRoot()).toBe(getProductionAppRoot());
  });
});
