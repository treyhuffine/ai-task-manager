import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  check: vi.fn(async () => {}),
  open: vi.fn(async () => ({ url: 'https://team.example' })),
  save: vi.fn((url: string) => url),
}));
vi.mock('@/lib/preview/beamd/cli', () => ({ beamdCheck: mocks.check }));
vi.mock('@/lib/preview/beamd/ownership', () => ({ openOwnedTunnel: mocks.open }));
vi.mock('@/lib/auth/bootstrap', () => ({ getTunnelName: () => null, setRemoteBaseUrl: mocks.save }));
vi.mock('@/lib/home/team-intent', () => ({ readTeamIntent: () => null }));
import { openAndSaveBeamdBaseUrl } from './beamd-base-url';

beforeEach(() => vi.clearAllMocks());

it('keeps the personal tunnel flow unchanged without a verifier', async () => {
  await expect(openAndSaveBeamdBaseUrl(42393, { name: 'test-team' })).resolves.toEqual({ url: 'https://team.example', name: 'test-team', port: 42393 });
  expect(mocks.save).toHaveBeenCalledWith('https://team.example');
});

it('does not save a team address before it has been verified', async () => {
  const verifyUrl = vi.fn(async () => { throw new Error('Wrong team'); });
  await expect(openAndSaveBeamdBaseUrl(42393, { name: 'test-team', verifyUrl })).rejects.toThrow('Wrong team');
  expect(verifyUrl).toHaveBeenCalledWith('https://team.example');
  expect(mocks.save).not.toHaveBeenCalled();
});

it('saves a verified team address', async () => {
  const verifyUrl = vi.fn(async (url: string) => {
    expect(mocks.save).not.toHaveBeenCalled();
    return url;
  });
  await openAndSaveBeamdBaseUrl(42393, { name: 'test-team', verifyUrl });
  expect(mocks.save).toHaveBeenCalledWith('https://team.example');
});
