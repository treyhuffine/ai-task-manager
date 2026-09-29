/**
 * A pairing link's token (`#token=...`) authenticates this browser from its
 * first request, whichever component makes it. The layout mounts components
 * whose requests could run before PairingBootstrap stored the token, and the
 * 401 signed the browser out.
 */

import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AUTH_TOKEN_STORAGE_KEY, getAuthToken } from './client';

let hash = '';
const storage = new Map<string, string>();

beforeEach(() => {
  hash = '';
  storage.clear();
  vi.stubGlobal('window', {
    location: {
      get hash() {
        return hash;
      },
    },
    localStorage: {
      getItem: (k: string) => storage.get(k) ?? null,
      setItem: (k: string, v: string) => void storage.set(k, v),
      removeItem: (k: string) => void storage.delete(k),
    },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("is the pairing link's token before anything stored it, and stores it", () => {
  hash = '#token=ri_live_from_the_link';
  expect(getAuthToken()).toBe('ri_live_from_the_link');
  expect(storage.get(AUTH_TOKEN_STORAGE_KEY)).toBe('ri_live_from_the_link');
});

it('is the stored token without a link, and none when nothing is stored', () => {
  expect(getAuthToken()).toBeNull();
  storage.set(AUTH_TOKEN_STORAGE_KEY, 'ri_live_stored');
  expect(getAuthToken()).toBe('ri_live_stored');
  hash = '#associate=code-only';
  expect(getAuthToken()).toBe('ri_live_stored');
});
