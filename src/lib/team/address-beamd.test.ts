import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createTestHome, type TestHome } from '@/test/fixtures/home';
import { writeTeamIntent } from '@/lib/home/team-intent';
import { ensureHomeIdentity } from '@/lib/home/identity';
import { getHome, inspectTeamGrant, renameTeam } from '@/lib/db/queries';
import { readAuthConfig, writeAuthConfig } from '@/lib/auth/config-file';
import { appBeamdTunnelName } from '@/lib/auth/beamd-base-url';

const mocks = vi.hoisted(() => ({ check: vi.fn(), open: vi.fn() }));
vi.mock('@/lib/preview/beamd/cli', () => ({ beamdCheck: mocks.check }));
vi.mock('@/lib/preview/beamd/ownership', () => ({ openOwnedTunnel: mocks.open }));
import { openTeamBeamdAddress, saveTeamAddressPrefix, teamAddressSettings } from './address';
import { getAutoTunnel } from '@/lib/auth/bootstrap';

let home: TestHome;
beforeEach(async () => {
  vi.resetAllMocks();
  vi.stubEnv('RI_TUNNEL_NAME', '');
  home = await createTestHome({ prefix: 'ri-team-address-', openDb: false });
  writeTeamIntent({ creationId: 'address-fixture-1234' });
  ensureHomeIdentity();
  renameTeam('Team Huffine');
  mocks.check.mockResolvedValue(undefined);
  mocks.open.mockImplementation(async (port, name) => ({ port, name, url: `https://${name}-trey.beamd.run` }));
  vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
    const { secret } = JSON.parse(init.body);
    const { grant } = inspectTeamGrant(secret, 'invite');
    return Response.json({ grantId: grant?.id, team: { id: getHome()?.id }, state: 'revoked' });
  }));
});
afterEach(async () => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  await home.cleanup();
});

it('suggests the name chosen in browser setup without moving an existing fallback address', () => {
  expect(teamAddressSettings()).toMatchObject({ suggestedName: 'team-huffine', tunnelName: 'ri-team-1234', address: null });
  expect(appBeamdTunnelName()).toBe('ri-team-1234');
});

it('saves a prefix for later without enabling remote access or contacting a provider', () => {
  expect(saveTeamAddressPrefix(' Huffines ')).toMatchObject({ suggestedName: 'huffines', tunnelName: 'huffines', address: null, autoTunnel: false });
  expect(readAuthConfig()).toMatchObject({ tunnelName: 'huffines', tunnelUrl: null, autoTunnel: null });
  expect(getAutoTunnel()).toBe(false);
  renameTeam('A different name');
  expect(teamAddressSettings().suggestedName).toBe('huffines');
  expect(mocks.check).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

it.each(['', 'has spaces', '-starts', 'x'.repeat(64)])('refuses an invalid saved prefix: %s', (name) => {
  expect(() => saveTeamAddressPrefix(name)).toThrow('Use letters');
  expect(appBeamdTunnelName()).toBe('ri-team-1234');
});

it.each([
  { tunnelUrl: 'https://existing.example.com', autoTunnel: false },
  { tunnelUrl: null, autoTunnel: true },
])('does not let stale setup change an existing remote configuration: %j', (remote) => {
  writeAuthConfig({ tunnelName: 'existing', ...remote });
  const before = readAuthConfig();
  expect(() => saveTeamAddressPrefix('huffines')).toThrow('already has remote access configured');
  expect(() => saveTeamAddressPrefix('existing')).not.toThrow();
  expect(readAuthConfig()).toEqual(before);
});

it('respects a host-controlled prefix when saving for later', () => {
  vi.stubEnv('RI_TUNNEL_NAME', 'host-chosen');
  expect(() => saveTeamAddressPrefix('huffines')).toThrow('hosting computer controls');
  expect(saveTeamAddressPrefix('host-chosen')).toMatchObject({ tunnelName: 'host-chosen', autoTunnel: false });
  expect(mocks.open).not.toHaveBeenCalled();
});

it('opens the chosen prefix on the team port and persists the verified address and reconnect choice together', async () => {
  await expect(openTeamBeamdAddress(43333, ' Team-Huffine ')).resolves.toEqual({ address: 'https://team-huffine-trey.beamd.run' });
  expect(mocks.open).toHaveBeenCalledWith(43333, 'team-huffine');
  expect(readAuthConfig()).toMatchObject({ tunnelName: 'team-huffine', tunnelUrl: 'https://team-huffine-trey.beamd.run', autoTunnel: true });
  renameTeam('A different display name');
  expect(appBeamdTunnelName()).toBe('team-huffine');
});

it.each(['', 'has spaces', 'two.labels', '-starts', 'ends-', 'x'.repeat(64)])('rejects invalid prefixes before contacting Beamd: %s', async (name) => {
  await expect(openTeamBeamdAddress(43333, name)).rejects.toThrow('Use letters');
  expect(mocks.check).not.toHaveBeenCalled();
  expect(mocks.open).not.toHaveBeenCalled();
});

it.each(['taken', 'wrong-team', 'offline'])('keeps the old address and name when opening a replacement fails: %s', async (failure) => {
  writeAuthConfig({ tunnelName: 'existing', tunnelUrl: 'https://existing-trey.beamd.run', autoTunnel: true });
  if (failure === 'taken') mocks.open.mockRejectedValueOnce(new Error('Name is taken'));
  if (failure === 'wrong-team') vi.mocked(fetch).mockResolvedValueOnce(Response.json({ grantId: 'wrong', team: { id: 'wrong' }, state: 'revoked' }));
  if (failure === 'offline') vi.mocked(fetch).mockRejectedValueOnce(new Error('Offline'));
  await expect(openTeamBeamdAddress(43333, 'team-huffine')).rejects.toThrow();
  expect(readAuthConfig()).toMatchObject({ tunnelName: 'existing', tunnelUrl: 'https://existing-trey.beamd.run', autoTunnel: true });
});

it('respects a prefix pinned by the host environment', async () => {
  vi.stubEnv('RI_TUNNEL_NAME', 'host-chosen');
  expect(teamAddressSettings()).toMatchObject({ nameLocked: true, tunnelName: 'host-chosen' });
  await expect(openTeamBeamdAddress(43333, 'team-huffine')).rejects.toThrow('hosting computer controls');
  expect(mocks.check).not.toHaveBeenCalled();
  await expect(openTeamBeamdAddress(43333, 'host-chosen')).resolves.toEqual({ address: 'https://host-chosen-trey.beamd.run' });
});
