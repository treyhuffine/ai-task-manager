import { afterEach, expect, it, vi } from 'vitest';
import { finishTeamSetup, previewTeamLink, readSetupAttempt } from './client';

afterEach(() => vi.unstubAllGlobals());

it('does not claim an owner when the browser cannot persist its retry attempt', () => {
  vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => { throw new Error('blocked'); } });
  const fetch = vi.fn();
  vi.stubGlobal('fetch', fetch);
  expect(() => finishTeamSetup('setup-secret', 'Acme', 'Trey')).toThrow('keep site data');
  expect(fetch).not.toHaveBeenCalled();
});

it('persists a setup attempt before sending and reuses it after reply loss and a reload', async () => {
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
  vi.stubGlobal('navigator', { userAgent: 'Browser' });
  const requests: Array<Record<string, string>> = [];
  vi.stubGlobal('fetch', vi.fn(async (_path, init) => {
    const input = JSON.parse(init.body);
    expect(readSetupAttempt('setup-secret')?.attemptId).toBe(input.attemptId);
    requests.push(input);
    if (requests.length === 1) throw new TypeError('reply lost');
    return Response.json({ ok: true });
  }));
  await expect(finishTeamSetup('setup-secret', 'Acme', 'Trey')).rejects.toThrow('reach this team');
  expect(readSetupAttempt('setup-secret')).toMatchObject({ teamName: 'Acme', ownerName: 'Trey' });
  await previewTeamLink('setup', 'setup-secret');
  await finishTeamSetup('setup-secret', 'Acme', 'Trey');
  expect(new Set(requests.map((input) => input.attemptId)).size).toBe(1);
});
