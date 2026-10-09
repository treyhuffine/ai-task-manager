import { afterEach, expect, it, vi } from 'vitest';
import { localAppsEnabled } from '@/lib/local-apps/service';

afterEach(() => vi.unstubAllEnvs());

it('enables local apps without an environment override', () => {
  vi.stubEnv('RI_LOCAL_APPS', undefined);
  expect(localAppsEnabled()).toBe(true);
});

it.each(['0', '', 'false'])('keeps an explicit disabled override (%s)', (value) => {
  vi.stubEnv('RI_LOCAL_APPS', value);
  expect(localAppsEnabled()).toBe(false);
});

it('retains the existing explicit enable override', () => {
  vi.stubEnv('RI_LOCAL_APPS', '1');
  expect(localAppsEnabled()).toBe(true);
});
