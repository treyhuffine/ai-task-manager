import { afterEach, describe, expect, it, vi } from 'vitest';
import { normalizeTeamAddress, verifyTeamAddress } from './address';

const q = vi.hoisted(() => ({
  createTeamAddressProbe: vi.fn(() => ({ id: 'unpredictable-proof', secret: 'revoked-probe' })),
  deleteTeamAddressProbe: vi.fn(),
  getHome: () => ({ id: 'this-team' }),
}));
vi.mock('@/lib/db/queries', () => q);
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });

describe('verified team addresses', () => {
  it('accepts HTTPS origins, and HTTP only for development loopback', () => {
    expect(normalizeTeamAddress('acme.example')).toBe('https://acme.example');
    expect(normalizeTeamAddress('http://localhost:42251')).toBe('http://localhost:42251');
    for (const url of ['http://acme.example', 'https://user:password@acme.example', 'https://acme.example/join', 'https://acme.example#invite=x']) {
      expect(() => normalizeTeamAddress(url)).toThrow();
    }
    vi.stubEnv('NODE_ENV', 'production');
    expect(() => normalizeTeamAddress('http://localhost:42251')).toThrow('HTTPS');
  });

  it('proves this team without sending any live credential or following redirects', async () => {
    const fetch = vi.fn(async () => Response.json({ grantId: 'unpredictable-proof', state: 'revoked', team: { id: 'this-team' } }));
    vi.stubGlobal('fetch', fetch);
    expect(await verifyTeamAddress('https://acme.example')).toBe('https://acme.example');
    expect(fetch).toHaveBeenCalledWith('https://acme.example/api/team/public/preview', expect.objectContaining({
      redirect: 'error', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'invite', secret: 'revoked-probe' }),
    }));
    expect(q.deleteTeamAddressProbe).toHaveBeenCalledWith('unpredictable-proof');
  });

  it.each([
    { grantId: 'wrong-proof', state: 'revoked', team: { id: 'this-team' } },
    { grantId: 'unpredictable-proof', state: 'revoked', team: { id: 'another-team' } },
    { grantId: 'unpredictable-proof', state: 'valid', team: { id: 'this-team' } },
    {},
  ])('refuses an unrelated or forged response: %j', async (response) => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(response)));
    await expect(verifyTeamAddress('https://wrong.example')).rejects.toThrow('does not reach this team');
    expect(q.deleteTeamAddressProbe).toHaveBeenCalledOnce();
  });

  it.each(['offline', 'redirect', 'oversize'])('cleans up after %s', async (failure) => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (failure === 'offline') throw new TypeError('failed');
      return failure === 'redirect' ? new Response(null, { status: 302 }) : new Response('x'.repeat(20_000));
    }));
    await expect(verifyTeamAddress('https://wrong.example')).rejects.toThrow('Could not verify');
    expect(q.deleteTeamAddressProbe).toHaveBeenCalledOnce();
  });
});
